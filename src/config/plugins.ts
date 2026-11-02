export default ({ env }: { env: any }) => ({
  'users-permissions': {
    config: {
      providers: [
        {
          name: 'google',
          clientId: env('GOOGLE_CLIENT_ID'),
          clientSecret: env('GOOGLE_CLIENT_SECRET'),
          redirectUri: env(
            'GOOGLE_REDIRECT_URI',
            'https://api-hotel.qenenia.com/api/connect/google/callback'
          ),
          scope: ['email', 'profile', 'openid'],
        },
      ],
    },
  },
});