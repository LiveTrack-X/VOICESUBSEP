function hasExited(child) {
  return !child?.pid || child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (exited) => { clearTimeout(timer); child.removeListener('exit', onExit); resolve(exited); };
    const onExit = () => done(true);
    const timer = setTimeout(() => done(hasExited(child)), timeoutMs);
    child.once('exit', onExit);
  });
}

async function stopOwnedBackend({ child, shutdown, forceKill, graceMs = 12000, killMs = 3000 }) {
  if (hasExited(child)) return true;
  let requested = false;
  try { await shutdown(); requested = true; } catch { /* The process may no longer serve HTTP. */ }
  if (requested && await waitForExit(child, graceMs)) return true;
  if (hasExited(child)) return true;
  await forceKill(child);
  // taskkill exiting is not proof that the owned backend has actually exited.
  return waitForExit(child, killMs);
}

module.exports = { hasExited, waitForExit, stopOwnedBackend };
