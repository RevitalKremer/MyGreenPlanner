#!/usr/bin/env bash
# Phase 4 — set up GitHub OIDC + IAM role so GitHub Actions can deploy to AWS
# without long-lived access keys.
set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-mgp}"
REGION="${AWS_REGION_OVERRIDE:-eu-central-1}"
PROJECT="mgp"
GITHUB_ORG="RevitalKremer"
GITHUB_REPO="MyGreenPlanner"
GITHUB_BRANCH="master"  # only pushes to this branch can deploy
ROLE_NAME="${PROJECT}-gha-deploy"

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }
log() { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }

ACCOUNT_ID=$(aws_ sts get-caller-identity --query Account --output text)
INSTANCE_ID=$(cat "$(dirname "$0")/.instance-id")
BUCKET_NAME=$(cat "$(dirname "$0")/.bucket")
OIDC_PROVIDER_URL="token.actions.githubusercontent.com"
OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER_URL}"

log "GitHub OIDC identity provider"
if ! aws_ iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" >/dev/null 2>&1; then
  aws_ iam create-open-id-connect-provider \
    --url "https://${OIDC_PROVIDER_URL}" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" >/dev/null
  echo "Created OIDC provider."
else
  echo "Already exists."
fi

log "IAM role ${ROLE_NAME} (assumable by GitHub Actions on ${GITHUB_ORG}/${GITHUB_REPO}@${GITHUB_BRANCH})"
TRUST_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${OIDC_PROVIDER_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "${OIDC_PROVIDER_URL}:aud": "sts.amazonaws.com",
        "${OIDC_PROVIDER_URL}:sub": "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/${GITHUB_BRANCH}"
      }
    }
  }]
}
JSON
)

if aws_ iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws_ iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST_POLICY"
  echo "Role exists — trust policy refreshed."
else
  aws_ iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" >/dev/null
  echo "Role created."
fi

log "Inline permissions (scoped to this project only)"
DEPLOY_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendDeployCommandToInstance",
      "Effect": "Allow",
      "Action": ["ssm:SendCommand"],
      "Resource": [
        "arn:aws:ec2:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}",
        "arn:aws:ssm:${REGION}::document/AWS-RunShellScript"
      ]
    },
    {
      "Sid": "TrackCommandStatus",
      "Effect": "Allow",
      "Action": ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"],
      "Resource": "*"
    },
    {
      "Sid": "StageDeployArtifactsInBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/deploy/*"
    }
  ]
}
JSON
)
aws_ iam put-role-policy --role-name "$ROLE_NAME" --policy-name "${PROJECT}-deploy" --policy-document "$DEPLOY_POLICY"
echo "Inline policy attached."

# Grant the EC2 instance role permission to delete objects from the deploy prefix (cleanup).
EC2_ROLE="${PROJECT}-ec2-role"
aws_ iam put-role-policy --role-name "$EC2_ROLE" --policy-name "${PROJECT}-deploy-cleanup" --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::${BUCKET_NAME}/deploy/*"
  }]
}
JSON
)"

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
cat <<SUMMARY

============================================================
  PHASE 4 (AWS side) COMPLETE
============================================================
  OIDC provider:   arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER_URL}
  Deploy role:     ${ROLE_ARN}
  Trust condition: repo:${GITHUB_ORG}/${GITHUB_REPO} on ref refs/heads/${GITHUB_BRANCH}
  Scoped to:       instance ${INSTANCE_ID}
                   bucket   s3://${BUCKET_NAME}/deploy/*

  GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
    Name: AWS_DEPLOY_ROLE_ARN   Value: ${ROLE_ARN}
    Name: AWS_REGION            Value: ${REGION}
    Name: AWS_INSTANCE_ID       Value: ${INSTANCE_ID}
    Name: AWS_DEPLOY_BUCKET     Value: ${BUCKET_NAME}
============================================================
SUMMARY

echo "$ROLE_ARN" > "$(dirname "$0")/.deploy-role-arn"
