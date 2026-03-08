const { spawn } = require('child_process');
const fs = require('fs');

const el = spawn('npx', ['electron', '.'], { shell: true });

let log = '';
el.stdout.on('data', d => log += d.toString());
el.stderr.on('data', d => log += d.toString());

el.on('close', code => {
    fs.writeFileSync('error_out.txt', log + '\nExit code: ' + code, 'utf8');
    console.log('done');
});
