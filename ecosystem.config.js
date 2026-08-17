module.exports = {
  apps: [{
    name: 'tfd-lobby',
    script: './server.js',
    cwd: '/var/www/tfd/lobby',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 4002,
    },
    env_file: '.env',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
  }]
};
