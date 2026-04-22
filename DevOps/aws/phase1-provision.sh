#!/usr/bin/env bash
# Phase 1 — provision AWS infra for MyGreenPlanner
# Safe to re-run: each resource check exists before create.
set -euo pipefail

PROFILE="${AWS_PROFILE_OVERRIDE:-mgp}"
REGION="${AWS_REGION_OVERRIDE:-eu-central-1}"
PROJECT="mgp"
APP_NAME="mygreenplanner"
INSTANCE_TYPE="t4g.small"
DISK_GB=20

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

log() { printf "\n\033[1;34m==> %s\033[0m\n" "$*"; }

log "Account lookup"
ACCOUNT_ID=$(aws_ sts get-caller-identity --query Account --output text)
echo "Account: $ACCOUNT_ID   Region: $REGION"

log "Default VPC + subnet"
VPC_ID=$(aws_ ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC_ID" = "None" ] && { echo "No default VPC. Run: aws ec2 create-default-vpc --profile $PROFILE --region $REGION"; exit 1; }
SUBNET_ID=$(aws_ ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" "Name=default-for-az,Values=true" --query 'Subnets[0].SubnetId' --output text)
echo "VPC: $VPC_ID   Subnet: $SUBNET_ID"

log "Security group (80 + 443 from internet only)"
SG_NAME="${PROJECT}-ec2-sg"
SG_ID=$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws_ ec2 create-security-group --group-name "$SG_NAME" --description "HTTP/S only for $PROJECT" --vpc-id "$VPC_ID" --query GroupId --output text)
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80  --cidr 0.0.0.0/0 >/dev/null
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null
fi
echo "SG: $SG_ID"

log "S3 bucket for backups"
BUCKET_NAME="${PROJECT}-backups-${ACCOUNT_ID}"
if ! aws_ s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
  aws_ s3api create-bucket --bucket "$BUCKET_NAME" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  aws_ s3api put-public-access-block --bucket "$BUCKET_NAME" \
    --public-access-block-configuration 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
  aws_ s3api put-bucket-versioning --bucket "$BUCKET_NAME" --versioning-configuration Status=Enabled
  aws_ s3api put-bucket-encryption --bucket "$BUCKET_NAME" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
fi
echo "Bucket: $BUCKET_NAME"

log "IAM role + instance profile (SSM + S3 backup access)"
ROLE_NAME="${PROJECT}-ec2-role"
PROFILE_NAME="${PROJECT}-ec2-profile"
if ! aws_ iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws_ iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }' >/dev/null
  aws_ iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws_ iam put-role-policy --role-name "$ROLE_NAME" --policy-name "${PROJECT}-s3-backup" --policy-document "{
    \"Version\":\"2012-10-17\",
    \"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\",\"s3:ListBucket\"],\"Resource\":[\"arn:aws:s3:::${BUCKET_NAME}\",\"arn:aws:s3:::${BUCKET_NAME}/*\"]}]
  }"
fi
if ! aws_ iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  aws_ iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws_ iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME"
  echo "Waiting 15s for instance profile to propagate..."; sleep 15
fi
echo "Role: $ROLE_NAME   Profile: $PROFILE_NAME"

log "Looking up latest Ubuntu 24.04 ARM64 AMI"
AMI_ID=$(aws_ ssm get-parameter \
  --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id \
  --query 'Parameter.Value' --output text)
echo "AMI: $AMI_ID"

log "Preparing user-data bootstrap"
USERDATA_FILE=$(mktemp)
cat > "$USERDATA_FILE" <<'BOOT'
#!/bin/bash
set -e
exec > >(tee -a /var/log/mgp-bootstrap.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg fail2ban unattended-upgrades jq snapd

# AWS CLI v2 via snap (the awscli apt package was removed in Ubuntu 24.04).
snap install aws-cli --classic || true

# --- Docker ---
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker ubuntu

# --- Auto security updates ---
cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now unattended-upgrades

# --- fail2ban (protects future SSH if ever enabled; defaults are fine) ---
systemctl enable --now fail2ban

# --- App dir ---
mkdir -p /opt/mgp
chown ubuntu:ubuntu /opt/mgp

echo "Bootstrap complete"
BOOT

log "Launching EC2 instance ($INSTANCE_TYPE)"
INSTANCE_ID=$(aws_ ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --subnet-id "$SUBNET_ID" \
  --security-group-ids "$SG_ID" \
  --iam-instance-profile "Name=$PROFILE_NAME" \
  --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":$DISK_GB,\"VolumeType\":\"gp3\",\"Encrypted\":true}}]" \
  --user-data "file://$USERDATA_FILE" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$APP_NAME},{Key=Project,Value=$PROJECT}]" \
  --metadata-options 'HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=2' \
  --query 'Instances[0].InstanceId' --output text)
echo "Instance: $INSTANCE_ID"
rm -f "$USERDATA_FILE"

log "Waiting for instance to reach 'running' state..."
aws_ ec2 wait instance-running --instance-ids "$INSTANCE_ID"

log "Allocating + associating Elastic IP"
EIP_ALLOC=$(aws_ ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$APP_NAME}]" \
  --query AllocationId --output text)
aws_ ec2 associate-address --allocation-id "$EIP_ALLOC" --instance-id "$INSTANCE_ID" >/dev/null
EIP=$(aws_ ec2 describe-addresses --allocation-ids "$EIP_ALLOC" --query 'Addresses[0].PublicIp' --output text)

cat <<SUMMARY

============================================================
  PHASE 1 COMPLETE
============================================================
  Region:          $REGION
  Instance ID:     $INSTANCE_ID
  Instance type:   $INSTANCE_TYPE
  Elastic IP:      $EIP
  Security group:  $SG_ID
  IAM profile:     $PROFILE_NAME
  Backups bucket:  $BUCKET_NAME

  NEXT STEPS:
  1. Add DNS A record in LiveDNS:
       mygreenplanner.sadotenergy.co.il  ->  $EIP   (TTL 300)
  2. Wait ~3 min for user-data bootstrap to finish, then:
       aws ssm start-session --target $INSTANCE_ID --profile $PROFILE --region $REGION
     Inside the session:
       sudo tail -n 30 /var/log/mgp-bootstrap.log
       docker --version
============================================================
SUMMARY

echo "$INSTANCE_ID" > "$(dirname "$0")/.instance-id"
echo "$EIP" > "$(dirname "$0")/.eip"
echo "$SG_ID" > "$(dirname "$0")/.sg-id"
echo "$EIP_ALLOC" > "$(dirname "$0")/.eip-alloc"
echo "$BUCKET_NAME" > "$(dirname "$0")/.bucket"
