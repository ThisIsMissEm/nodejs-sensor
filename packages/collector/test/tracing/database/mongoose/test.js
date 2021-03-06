'use strict';

const expect = require('chai').expect;
const uuid = require('uuid/v4');

const constants = require('@instana/core').tracing.constants;
const supportedVersion = require('@instana/core').tracing.supportedVersion;
const config = require('../../../../../core/test/config');
const { expectExactlyOneMatching, retry } = require('../../../../../core/test/test_util');
const ProcessControls = require('../../../test_util/ProcessControls');

describe('tracing/mongoose', function() {
  if (!supportedVersion(process.versions.node)) {
    return;
  }

  const agentControls = require('../../../apps/agentStubControls');

  this.timeout(config.getTestTimeout());

  agentControls.registerTestHooks();

  const controls = new ProcessControls({
    dirname: __dirname,
    agentControls
  }).registerTestHooks();

  it('must trace create calls', () =>
    controls
      .sendRequest({
        method: 'POST',
        path: '/insert',
        body: {
          name: 'Some Body',
          age: 999
        }
      })
      .then(() =>
        retry(() =>
          agentControls.getSpans().then(spans => {
            const entrySpan = expectEntry(spans, '/insert');
            expectMongoExit(spans, entrySpan, 'insert');
          })
        )
      ));

  it('must trace findOne calls', () => {
    const randomName = uuid();
    return controls
      .sendRequest({
        method: 'POST',
        path: '/insert',
        body: {
          name: randomName,
          age: 42
        }
      })
      .then(() =>
        controls.sendRequest({
          method: 'POST',
          path: '/find',
          body: {
            name: randomName,
            age: 42
          }
        })
      )
      .then(() =>
        retry(() =>
          agentControls.getSpans().then(spans => {
            const entrySpan = expectEntry(spans, '/find');
            const mongoExit = expectMongoExit(spans, entrySpan, 'find');
            expect(mongoExit.data.mongo.filter).to.contain('"age":42');
            expect(mongoExit.data.mongo.filter).to.contain(`"name":"${randomName}"`);
          })
        )
      );
  });

  it('must trace aggregate calls', () => {
    return controls
      .sendRequest({
        method: 'POST',
        path: '/aggregate'
      })
      .then(res => {
        expect(res).to.be.an('array');
        const group1 = res.find(o => o._id === 33);
        const group2 = res.find(o => o._id === 77);
        expect(group1.totalCount).to.equal(2);
        expect(group1.totalAge).to.equal(66);
        expect(group2.totalCount).to.equal(1);
        expect(group2.totalAge).to.equal(77);
        return retry(() =>
          agentControls.getSpans().then(spans => {
            const entrySpan = expectEntry(spans, '/aggregate');
            const mongoExit = expectMongoExit(spans, entrySpan, 'aggregate');
            expect(mongoExit.data.mongo.json).to.contain('"$match"');
            expect(mongoExit.data.mongo.json).to.contain('"$group"');
            expect(mongoExit.data.mongo.json).to.contain('"$project"');
          })
        );
      });
  });

  function expectEntry(spans, url) {
    return expectExactlyOneMatching(spans, span => {
      expect(span.n).to.equal('node.http.server');
      expect(span.data.http.url).to.equal(url);
      expect(span.f.e).to.equal(String(controls.getPid()));
      expect(span.f.h).to.equal('agent-stub-uuid');
      expect(span.async).to.not.exist;
      expect(span.error).to.not.exist;
      expect(span.ec).to.equal(0);
    });
  }

  function expectMongoExit(spans, parent, command) {
    return expectExactlyOneMatching(spans, span => {
      expect(span.t).to.equal(parent.t);
      expect(span.p).to.equal(parent.s);
      expect(span.n).to.equal('mongo');
      expect(span.k).to.equal(constants.EXIT);
      expect(span.f.e).to.equal(String(controls.getPid()));
      expect(span.f.h).to.equal('agent-stub-uuid');
      expect(span.async).to.not.exist;
      expect(span.error).to.not.exist;
      expect(span.ec).to.equal(0);
      expect(span.data.mongo.command).to.equal(command);
      expect(span.data.mongo.service).to.equal(process.env.MONGODB);
      expect(span.data.mongo.namespace).to.equal('mongoose.people');
    });
  }
});
