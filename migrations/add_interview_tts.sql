-- 面试录音 TTS 支持
ALTER TABLE interview_audios ADD COLUMN tts_audio_key TEXT;
ALTER TABLE interview_audios ADD COLUMN tts_voice TEXT;
ALTER TABLE interview_audios ADD COLUMN tts_model TEXT;
