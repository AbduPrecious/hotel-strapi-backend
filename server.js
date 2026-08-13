/**
 * Strapi Server Startup File for cPanel
 *
 * This file can be used as the startup file in cPanel Node.js Selector
 * if your hosting requires a specific entry point.
 *
 * Note: Strapi typically handles startup automatically via npm scripts,
 * but some cPanel setups may require this explicit entry point.
 */

// Load environment variables
require('dotenv').config();

// Start Strapi using Strapi 5 API
const { createStrapi, compileStrapi } = require('@strapi/strapi');

(async () => {
  try {
    // Compile Strapi
    const appContext = await compileStrapi();
    
    // Create and load Strapi instance
    const app = await createStrapi(appContext).load();
    
    // Start the server
    await app.start();
    
    console.log('Strapi started successfully');
  } catch (error) {
    console.error('Failed to start Strapi:', error);
    process.exit(1);
  }
})();