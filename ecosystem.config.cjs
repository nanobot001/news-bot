module.exports = {
  apps: [
    {
      name: "news-bot",
      script: "./dist/index.js",
      cwd: "C:\\Users\\antho\\Code\\news-bot",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    },
  ],
};
