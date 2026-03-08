try {
    const pty = require('node-pty');
    console.log('node-pty loaded successfully');
} catch (e) {
    console.error('Failed to load node-pty:', e);
}
