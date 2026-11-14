from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../../.env", ".env"), extra="ignore")

    # Where the Zendesk / CRM / shop endpoints live (apps/api).
    api_url: str = "http://localhost:4000"
    request_timeout_s: float = 15.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
