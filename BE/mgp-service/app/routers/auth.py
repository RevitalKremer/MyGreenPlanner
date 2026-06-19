from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.schemas.auth import Token, LoginRequest, ForgotPasswordRequest, ResetPasswordRequest
from app.schemas.user import UserCreate, UserRead, UserProfileUpdate
from app.services.auth import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    create_email_token,
    verify_email_token,
    decode_token,
    get_user_by_email,
    get_user_by_id,
    hash_password,
)
from app.services.email_service import send_verification_email, send_reset_email
from app.services import credits as credits_service
from app.services import company_service
from app.routers.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "mgp_refresh"


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        samesite="lax",
        secure=False,   # set True when serving over HTTPS
    )


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    company = await company_service.get_or_create(db, payload.company_name)
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        phone_number=payload.phone_number or None,
        company=company,  # sets company_id and keeps the relationship loaded
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await db.refresh(user, attribute_names=['company'])  # keep company loaded for the response
    token = create_email_token(user.email, "verify", expire_hours=24)
    await send_verification_email(user.email, token)
    return user


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, payload.email)
    if user and user.is_active:
        token = create_email_token(user.email, "reset", expire_hours=1)
        await send_reset_email(user.email, token)
    # Always 204 — never reveal whether the email exists


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    email = verify_email_token(payload.token, "reset")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")
    user = await get_user_by_email(db, email)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")
    user.hashed_password = hash_password(payload.new_password)
    await db.commit()


@router.get("/verify-email", status_code=status.HTTP_204_NO_CONTENT)
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    email = verify_email_token(token, "verify")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification token")
    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token")
    user.is_verified = True
    # Idempotent — credits_service skips users who already have a 'trial' row.
    # Safe to call on every verify (even re-verifications).
    await credits_service.grant_trial_if_eligible(db, user)
    await db.commit()


@router.post("/resend-verification", status_code=status.HTTP_204_NO_CONTENT)
async def resend_verification(current_user: User = Depends(get_current_user)):
    """Re-send the email-verification link to the logged-in user. No-op (still
    204) if they're already verified, so the FE can call it idempotently."""
    if current_user.is_verified:
        return
    token = create_email_token(current_user.email, "verify", expire_hours=24)
    await send_verification_email(current_user.email, token)


@router.post("/login", response_model=Token)
async def login(payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, payload.email, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    refresh_token = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, refresh_token)
    return Token(
        access_token=create_access_token(str(user.id)),
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=Token)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")
    try:
        data = decode_token(token)
        if data.get("type") != "refresh":
            raise ValueError
        user_id = uuid.UUID(data["sub"])
    except (JWTError, ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    new_refresh = create_refresh_token(str(user.id))
    _set_refresh_cookie(response, new_refresh)
    return Token(
        access_token=create_access_token(str(user.id)),
        refresh_token=new_refresh,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    response.delete_cookie(key=REFRESH_COOKIE, samesite="lax")


async def _user_read_with_credits(db: AsyncSession, user: User) -> UserRead:
    """Build a UserRead with credits_available/used/total computed from the ledger."""
    await db.refresh(user, attribute_names=['company'])  # ensure company_name resolves
    snapshot = await credits_service.compute_account_snapshot(db, user)
    base = UserRead.model_validate(user)
    return base.model_copy(update=snapshot)


@router.get("/me", response_model=UserRead)
async def me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await _user_read_with_credits(db, current_user)


@router.patch("/me", response_model=UserRead)
async def update_me(
    payload: UserProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.full_name is not None:
        current_user.full_name = payload.full_name
    if payload.phone_number is not None:
        # Validated non-blank by UserProfileUpdate; store as-is.
        current_user.phone_number = payload.phone_number.strip()
    if payload.lang is not None:
        current_user.lang = payload.lang
    if payload.company_name is not None:
        # Validated non-blank; resolve to a Company (get-or-create) and assign.
        # Project sharing is derived from this company live — nothing else to do.
        current_user.company = await company_service.get_or_create(db, payload.company_name)
    await db.commit()
    await db.refresh(current_user)
    return await _user_read_with_credits(db, current_user)
