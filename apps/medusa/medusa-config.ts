import {
  ContainerRegistrationKeys,
  loadEnv,
  defineConfig,
  Modules,
} from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const isProd = process.env.NODE_ENV === 'production'
const medusaUrl = process.env.MEDUSA_URL || `http://localhost:${process.env.PORT || 9000}`
// Browsers drop Secure cookies on plain HTTP (e.g. EC2 public IP). Use HTTPS in prod when possible.
const cookieSecure =
  process.env.MEDUSA_COOKIE_SECURE === 'true' ||
  (process.env.MEDUSA_COOKIE_SECURE !== 'false' && medusaUrl.startsWith('https://'))

const databaseDriverOptions =
  process.env.DATABASE_SSL === 'true'
    ? { connection: { ssl: { rejectUnauthorized: true } } }
    : { connection: { ssl: false } }

const s3Configured = Boolean(
  process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
)

const authModule = {
  resolve: '@medusajs/medusa/auth',
  dependencies: [Modules.CACHE, ContainerRegistrationKeys.LOGGER],
  options: {
    providers: [
      {
        resolve: '@medusajs/medusa/auth-emailpass',
        id: 'emailpass',
      },
    ],
  },
}

const fileModule = isProd
  ? {
      resolve: '@medusajs/medusa/file',
      options: {
        providers: [
          s3Configured
            ? {
                resolve: '@medusajs/medusa/file-s3',
                id: 's3',
                options: {
                  file_url: process.env.S3_FILE_URL,
                  access_key_id: process.env.S3_ACCESS_KEY_ID,
                  secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
                  region: process.env.S3_REGION,
                  bucket: process.env.S3_BUCKET,
                  endpoint: process.env.S3_ENDPOINT,
                  acl: false,
                  ...(process.env.S3_FORCE_PATH_STYLE === 'true'
                    ? { additional_client_config: { forcePathStyle: true } }
                    : {}),
                },
              }
            : {
                resolve: '@medusajs/medusa/file-local',
                id: 'local',
                options: {
                  upload_dir: 'uploads',
                  backend_url: medusaUrl,
                },
              },
        ],
      },
    }
  : null

module.exports = defineConfig({
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === 'true',
    // nginx serves admin + API on the same host — omit backendUrl so the browser uses same origin
  },
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions,
    redisUrl: process.env.REDIS_URL,
    cookieOptions: {
      sameSite: 'lax',
      secure: cookieSecure,
    },
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
      authMethodsPerActor: {
        user: ['emailpass'],
        customer: ['emailpass'],
      },
    },
  },
  ...(isProd && fileModule ? { modules: [authModule, fileModule] } : {}),
})
