import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs before the test files are imported: ConfigModule validates the
// environment as soon as AppModule is loaded, so the values must exist first.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
process.env.MEDIA_DIR = join(tmpdir(), 'cornergood-test-media');
process.env.OTP_SECRET ??= 'test-only-otp-secret-0123456789abcdef';
