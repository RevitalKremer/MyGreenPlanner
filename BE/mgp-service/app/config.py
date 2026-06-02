from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://localhost:5174,http://localhost:3000"

    # Email (optional — leave SMTP_HOST empty to log emails to console in dev)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@mygreenplanner.com"
    SMTP_TLS: bool = True
    FRONTEND_URL: str = "http://localhost:5173"
    COMPANY_REPORT_EMAIL: str = "lorikremer4@gmail.com"

    # Sysadmin bootstrap (created automatically on startup if not found)
    SYSADMIN_EMAIL: str = "sysadmin@mgp.local"
    SYSADMIN_PASSWORD: str = ""
    SYSADMIN_NAME: str = "System Administrator"

    # Monday.com integration — leave MONDAY_API_TOKEN empty to disable.
    # Files are attached to a post (update) on the item, not to a column.
    MONDAY_API_TOKEN: str = ""
    MONDAY_BOARD_ID: str = ""
    MONDAY_GROUP_ID: str = ""


settings = Settings()
