from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    supabase_url: str = ''
    supabase_service_role_key: str = ''
    groq_api_key: str = ''
    groq_model: str = 'openai/gpt-oss-120b'
    groq_transcription_model: str = 'whisper-large-v3-turbo'
    frontend_origin: str = 'http://localhost:5173'
    simulation_interval_seconds: float = 1.5
    enable_simulator: bool = True

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def groq_configured(self) -> bool:
        return bool(self.groq_api_key)


@lru_cache

def get_settings() -> Settings:
    return Settings()
