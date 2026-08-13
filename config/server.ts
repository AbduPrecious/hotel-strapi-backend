import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 3001),
  url: env('PUBLIC_URL', 'https://api-hotel.qenenia.com/'),
  app: {
    keys: env.array('APP_KEYS')!,
  },
});

export default config;
