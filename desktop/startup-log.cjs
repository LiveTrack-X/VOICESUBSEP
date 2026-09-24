const fs = require('node:fs');
const path = require('node:path');

/** Ready before deployment checks, so a missing backend can still be diagnosed. */
function createAppLogger(folder) {
  const file = path.join(folder, 'backend.log');
  try { fs.mkdirSync(folder, { recursive: true }); } catch { /* Startup can still report an error dialog. */ }
  return {
    file,
    write(message) {
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > 4 * 1024 * 1024) fs.renameSync(file, `${file}.previous`);
        fs.appendFileSync(file, String(message).slice(0, 32768));
        return true;
      } catch { return false; }
    },
  };
}

module.exports = { createAppLogger };
