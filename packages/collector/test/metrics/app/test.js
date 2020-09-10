'use strict';

const _ = require('lodash');
const async = require('async');
const copy = require('recursive-copy');
const expect = require('chai').expect;
const fs = require('fs');
const os = require('os');
const path = require('path');
const rimraf = require('rimraf');
const tar = require('tar');

const config = require('../../../../core/test/config');
const { retry } = require('../../../../core/test/test_util');
const ProcessControls = require('../../test_util/ProcessControls');

describe('snapshot data and metrics', function() {
  const timeout = Math.max(config.getTestTimeout(), 20000);
  this.timeout(timeout);
  const retryTimeout = timeout / 2;

  const agentControls = require('../../apps/agentStubControls');
  agentControls.registerTestHooks();
  const controls = new ProcessControls({
    appPath: path.join(__dirname, 'app'),
    args: ['foo', 'bar', 'baz']
  }).registerTestHooks();

  it('must report metrics from a running process', () =>
    retry(() =>
      Promise.all([
        //
        agentControls.getAllMetrics(controls.getPid()),
        agentControls.getAggregatedMetrics(controls.getPid())
      ]).then(([allMetrics, aggregated]) => {
        expect(findMetric(allMetrics, ['activeHandles'])).to.exist;
        expect(findMetric(allMetrics, ['activeRequests'])).to.exist;

        const args = findMetric(allMetrics, ['args']);
        expect(args).to.have.lengthOf(5);
        expect(args[0]).to.contain('node');
        expect(args[1]).to.contain('packages/collector/test/metrics/app/app');
        expect(args[2]).to.equal('foo');
        expect(args[3]).to.equal('bar');
        expect(args[4]).to.equal('baz');

        const deps = findMetric(allMetrics, ['dependencies']);
        expect(deps).to.be.an('object');
        expect(Object.keys(deps)).to.have.lengthOf(1);
        expect(deps['node-fetch']).to.equal('2.6.0');

        expect(findMetric(allMetrics, ['description'])).to.equal(
          'This is a test application to test snapshot and metrics data.'
        );

        const directDeps = findMetric(allMetrics, ['directDependencies']);
        expect(directDeps).to.be.an('object');
        expect(Object.keys(directDeps)).to.have.lengthOf.at.least(1);
        expect(directDeps.dependencies['node-fetch']).to.equal('^2.6.0');

        expect(findMetric(allMetrics, ['execArgs'])).to.be.an('array');
        expect(findMetric(allMetrics, ['execArgs'])).to.be.empty;

        expect(findMetric(allMetrics, ['gc', 'minorGcs'])).to.exist;
        expect(findMetric(allMetrics, ['gc', 'majorGcs'])).to.exist;

        expect(findMetric(allMetrics, ['healthchecks'])).to.exist;
        expect(findMetric(allMetrics, ['heapSpaces'])).to.exist;
        expect(findMetric(allMetrics, ['http'])).to.exist;
        expect(findMetric(allMetrics, ['keywords'])).to.deep.equal(['keyword1', 'keyword2']);
        const libuv = aggregated.libuv;
        expect(libuv).to.exist;
        expect(libuv).to.be.an('object');
        expect(libuv.statsSupported).to.be.true;
        expect(libuv.min).to.be.a('number');
        expect(libuv.max).to.be.a('number');
        expect(libuv.sum).to.be.a('number');
        expect(libuv.lag).to.be.a('number');
        expect(findMetric(allMetrics, ['memory'])).to.exist;
        expect(findMetric(allMetrics, ['name'])).to.equal('metrics-test-app');
        expect(findMetric(allMetrics, ['pid'])).to.equal(controls.getPid());
        expect(findMetric(allMetrics, ['versions'])).to.exist;
        expect(`v${findMetric(allMetrics, ['versions', 'node'])}`).to.equal(process.version);
      })
    ));

  // TODO tests for other native add-ons too, in particular autoprofiling
  describe('are activated lazily when support is initially missing', () => {
    const sharedMetricsNodeModules = path.join(__dirname, '..', '..', '..', '..', 'shared-metrics', 'node_modules');
    const resourcesPath = path.join(__dirname, '..', 'resources');

    [
      {
        name: 'event-loop-stats',
        nodeModulesPath: sharedMetricsNodeModules,
        nativeModulePath: path.join(sharedMetricsNodeModules, 'event-loop-stats'),
        backupPath: path.join(os.tmpdir(), 'event-loop-stats-backup'),
        resourcesPath,
        corruptTarGzPath: path.join(resourcesPath, 'event-loop-stats-corrupt.tar.gz'),
        corruptUnpackedPath: path.join(resourcesPath, 'event-loop-stats'),
        check: ([allMetrics, aggregated]) => {
          // check that libuv stats are initially reported as unsupported
          let foundAtLeastOneUnsupported;
          for (let i = 0; i < allMetrics.length; i++) {
            if (allMetrics[i].data.libuv) {
              expect(allMetrics[i].data.libuv.statsSupported).to.not.exist;
              foundAtLeastOneUnsupported = true;
              break;
            }
          }
          expect(foundAtLeastOneUnsupported).to.be.true;

          // The for loop above ensures that the first metric POST that had the libuv payload
          // had libuv.statsSupported === false. Now we check that at some point, the supported flag changed to true.
          const libuv = aggregated.libuv;
          expect(libuv).to.exist;
          expect(libuv).to.be.an('object');
          expect(libuv.statsSupported).to.be.true;
          expect(libuv.min).to.be.a('number');
          expect(libuv.max).to.be.a('number');
          expect(libuv.sum).to.be.a('number');
          expect(libuv.lag).to.be.a('number');
        }
      },
      {
        name: 'gcstats.js',
        nodeModulesPath: sharedMetricsNodeModules,
        nativeModulePath: path.join(sharedMetricsNodeModules, 'gcstats.js'),
        backupPath: path.join(os.tmpdir(), 'gcstats.js-backup'),
        resourcesPath,
        corruptTarGzPath: path.join(resourcesPath, 'gcstats.js-corrupt.tar.gz'),
        corruptUnpackedPath: path.join(resourcesPath, 'gcstats.js'),
        check: ([allMetrics, aggregated]) => {
          // check that gc stats are initially reported as unsupported
          let foundAtLeastOneUnsupported;
          for (let i = 0; i < allMetrics.length; i++) {
            if (allMetrics[i].data.libuv) {
              expect(allMetrics[i].data.gc.statsSupported).to.not.exist;
              foundAtLeastOneUnsupported = true;
              break;
            }
          }
          expect(foundAtLeastOneUnsupported).to.be.true;

          // The for loop above ensures that the first metric POST that had the gc payload
          // had gc.statsSupported == undefined. Now we check that at some point, the supported flag changed to true.
          const gc = aggregated.gc;
          expect(gc).to.exist;
          expect(gc).to.be.an('object');
          expect(gc.statsSupported).to.be.true;
          expect(gc.minorGcs).to.exist;
          expect(gc.majorGcs).to.exist;
        }
      }
    ].forEach(runLazyActivationOfNativeDependencyTest.bind(this, agentControls, controls, retryTimeout));
  });
});

function runLazyActivationOfNativeDependencyTest(agentControls, controls, retryTimeout, opts) {
  describe(opts.name, () => {
    before(done => {
      async.series(
        [
          tar.x.bind(null, {
            cwd: opts.resourcesPath,
            file: opts.corruptTarGzPath
          }),
          fs.rename.bind(null, opts.nativeModulePath, opts.backupPath),
          copy.bind(null, opts.corruptUnpackedPath, opts.nativeModulePath)
        ],
        done
      );
    });

    after(done => {
      async.series(
        [
          rimraf.bind(null, opts.nativeModulePath),
          rimraf.bind(null, opts.corruptUnpackedPath),
          fs.rename.bind(null, opts.backupPath, opts.nativeModulePath)
        ],
        done
      );
    });

    it('metrics from native add-ons should become available at some point', () =>
      retry(
        () =>
          Promise.all([
            //
            agentControls.getAllMetrics(controls.getPid()),
            agentControls.getAggregatedMetrics(controls.getPid())
          ]).then(opts.check),
        retryTimeout
      ));
  });
}

function findMetric(allMetrics, _path) {
  for (let i = allMetrics.length - 1; i >= 0; i--) {
    const value = _.get(allMetrics[i], ['data'].concat(_path));
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}
