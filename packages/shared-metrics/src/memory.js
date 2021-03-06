'use strict';

exports.payloadPrefix = 'memory';
exports.currentPayload = {};

let activeIntervalHandle = null;

exports.activate = function activate() {
  gatherMemoryUsageStatistics();
  activeIntervalHandle = setInterval(gatherMemoryUsageStatistics, 1000);
  activeIntervalHandle.unref();
};

function gatherMemoryUsageStatistics() {
  exports.currentPayload = process.memoryUsage();
}

exports.deactivate = function deactivate() {
  exports.currentPayload = {};
  if (activeIntervalHandle) {
    clearInterval(activeIntervalHandle);
  }
};
