'use strict';

let logger = require('@instana/core').logger.getLogger('metrics');
exports.setLogger = function setLogger(_logger) {
  logger = _logger;
};

const EventEmitter = require('events');
const copy = require('recursive-copy');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');
const { fork } = require('child_process');

const abiMap = require('./abi-map.json');

const retryMechanisms = ['copy-precompiled', 'rebuild'];

class ModuleLoadEmitter extends EventEmitter {}

function loadNativeAddOn(opts) {
  const loaderEmitter = new ModuleLoadEmitter();
  // Give clients a chance to register event listeners on the emitter that we return by attempting to load the module
  // asynchronously on the next tick.
  process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, 0));
  return loaderEmitter;
}

function loadNativeAddOnInternal(opts, loaderEmitter, retryIndex, skipAttempt) {
  if (skipAttempt) {
    // The logic of the previous retry mechanism figured out that it cannot complete successfully, so there is no reason
    // to try to require the module again. Skip directly to the next retry.
    logger.debug(`Skipping attempt ${retryIndex + 1} to load native add-on ${opts.nativeModuleName}.`);
    prepareNextRetry(opts, loaderEmitter, retryIndex);
  } else {
    logger.debug(`Attempt ${retryIndex + 1} to load native add-on ${opts.nativeModuleName}.`);
    try {
      // Try to actually require the native add-on module.
      const nativeModule = require(opts.nativeModuleName);
      loaderEmitter.emit('loaded', nativeModule);
      logger.debug(`Attempt ${retryIndex + 1} to load native add-on ${opts.nativeModuleName} has been successful.`);
    } catch (e) {
      logger.debug(`Attempt ${retryIndex + 1} to load native add-on ${opts.nativeModuleName} has failed.`, e);
      prepareNextRetry(opts, loaderEmitter, retryIndex);
    }
  }
}

function prepareNextRetry(opts, loaderEmitter, retryIndex) {
  // The first pre-condition for all retry mechanisms is that we can find the path to the native add-on that can not be
  // required.
  if (!opts.nativeModulePath || !opts.nativeModuleParentPath) {
    findNativeModulePath(opts);
    if (!opts.nativeModulePath || !opts.nativeModuleParentPath) {
      // TODO If the native module is not present at all in node_modules, we should fall back to figuring out the path
      // to "our" node_modules folder (and create it, if necessary).
      logger.warn(opts.message + ' (No retry attempted.)');
      loaderEmitter.emit('failed');
      return;
    }
  }

  const nextRetryMechanism = retryMechanisms[retryIndex];
  if (!nextRetryMechanism) {
    // We have exhausted all possible mechanisms to cope with the failure to load the native add-on.
    logger.warn(opts.message);
    loaderEmitter.emit('failed');
  } else if (nextRetryMechanism === 'copy-precompiled') {
    copyPrecompiled(opts, loaderEmitter, retryIndex);
  } else if (nextRetryMechanism === 'rebuild') {
    rebuildOnDemand(opts, loaderEmitter, retryIndex);
  } else {
    logger.error(
      `Unknown retry mechanism for loading the native module ${opts.nativeModuleName}: ${nextRetryMechanism}.`
    );
    process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
  }
}

function copyPrecompiled(opts, loaderEmitter, retryIndex) {
  const abi = abiMap[process.version];
  if (abi) {
    const platform = os.platform();
    const arch = process.arch;
    const libcFlavour = 'glibc';
    const label =
      platform === 'linux' ? `(${platform}/${arch}/${libcFlavour}/ABI ${abi})` : `(${platform}/${arch}/ABI ${abi})`;
    const precompiledPathPrefix = path.join(__dirname, '..', '..', 'addons', platform, arch);
    const precompiledTarGzPath =
      platform === 'linux'
        ? path.join(precompiledPathPrefix, libcFlavour, abi, `${opts.nativeModuleName}.tar.gz`)
        : path.join(precompiledPathPrefix, abi, `${opts.nativeModuleName}.tar.gz`);
    fs.stat(precompiledTarGzPath, statsErr => {
      if (statsErr && statsErr.code === 'ENOENT') {
        logger.info(`A precompiled version for ${opts.nativeModuleName} is not available ${label}.`);
        process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
        return;
      } else if (statsErr) {
        logger.warn(`Looking for a precompiled version for ${opts.nativeModuleName} ${label} failed.`, statsErr);
        process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
        return;
      }

      logger.info(`Found a precompiled version for ${opts.nativeModuleName} ${label}, unpacking.`);

      tar
        .x({
          cwd: os.tmpdir(),
          file: precompiledTarGzPath
        })
        .then(tarErr => {
          if (tarErr) {
            logger.warn(`Unpacking the precompiled build for ${opts.nativeModuleName} ${label} failed.`, tarErr);
            process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
            return;
          }
          copy(
            path.join(os.tmpdir(), opts.nativeModuleName),
            opts.nativeModulePath,
            {
              overwrite: true,
              dot: true
            },
            cpErr => {
              if (cpErr) {
                logger.warn(`Copying the precompiled build for ${opts.nativeModuleName} ${label} failed.`, cpErr);
                process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
                return;
              }
              // We have unpacked and copied the correct precompiled native addon. The next attempt to require the
              // dependency should work.
              process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex));
            }
          );
        });
    });
  } else {
    logger.warn('Could not determine ABI version.');
    process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
  }
}

function rebuildOnDemand(opts, loaderEmitter, retryIndex) {
  let nodeGypExecutable;
  try {
    const nodeGypPath = require.resolve('node-gyp');
    if (!nodeGypPath) {
      logger.warn(
        // eslint-disable-next-line max-len
        `Could not find node-gyp (require.resolve didn't return anything) to rebuild ${opts.nativeModuleName} on demand.`
      );
      process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
      return;
    }
    nodeGypExecutable = path.join(nodeGypPath, '..', '..', 'bin', 'node-gyp.js');
  } catch (e) {
    logger.warn(`Could not load node-gyp to rebuild ${opts.nativeModuleName} on demand.`, e);
    process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
    return;
  }

  logger.info(`Rebuilding ${opts.nativeModulePath} via ${nodeGypExecutable}.`);
  const nodeGyp = fork(nodeGypExecutable, ['rebuild'], {
    cwd: opts.nativeModulePath
  });
  nodeGyp.on('error', err => {
    logger.warn(
      // eslint-disable-next-line max-len
      `Attempt to rebuild ${opts.nativeModulePath} via ${nodeGypExecutable} has failed with an error.`,
      err
    );
  });
  nodeGyp.on('close', code => {
    if (code === 0) {
      logger.info(
        // eslint-disable-next-line max-len
        `Attempt to rebuild ${opts.nativeModulePath} via ${nodeGypExecutable} has finished, will try to load the module again.`
      );
      process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex));
    } else {
      logger.warn(
        `Attempt to rebuild ${opts.nativeModulePath} via ${nodeGypExecutable} has failed with exit code ${code}.`
      );
      process.nextTick(loadNativeAddOnInternal.bind(null, opts, loaderEmitter, ++retryIndex, true));
    }
  });
}

function findNativeModulePath(opts) {
  try {
    const nativeModulePath = require.resolve(opts.nativeModuleName);
    if (!nativeModulePath) {
      logger.warn(`Could not find location for ${opts.nativeModuleName} (require.resolve didn't return anything).`);
      return null;
    }
    const idx = nativeModulePath.lastIndexOf('node_modules');
    if (idx < 0) {
      logger.warn(`Could not find node_modules substring in ${nativeModulePath}.`);
      return null;
    }

    opts.nativeModulePath = nativeModulePath.substring(
      0,
      idx + 'node_modules'.length + opts.nativeModuleName.length + 2
    );
    opts.nativeModuleParentPath = path.join(opts.nativeModulePath, '..');
  } catch (e) {
    logger.warn(`Could not find location for ${opts.nativeModuleName}.`, e);
    return null;
  }
}

module.exports = exports = loadNativeAddOn;
