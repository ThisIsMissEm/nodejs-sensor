'use strict';

const bodyParser = require('body-parser');
const bunyan = require('bunyan');
const express = require('express');
const _ = require('lodash');
// const morgan = require('morgan');
const app = express();

const deepMerge = require('../../../core/src/util/deepMerge');

const logger = bunyan.createLogger({ name: 'agent-stub', pid: process.pid });
// logger.level('debug');

const extraHeaders = process.env.EXTRA_HEADERS ? process.env.EXTRA_HEADERS.split(',') : [];
const secretsMatcher = process.env.SECRETS_MATCHER ? process.env.SECRETS_MATCHER : 'contains-ignore-case';
const secretsList = process.env.SECRETS_LIST ? process.env.SECRETS_LIST.split(',') : ['key', 'pass', 'secret'];
const dropAllData = process.env.DROP_DATA === 'true';
const logTraces = process.env.LOG_TRACES === 'true';
const logProfiles = process.env.LOG_PROFILES === 'true';
const rejectTraces = process.env.REJECT_TRACES === 'true';
const doesntHandleProfiles = process.env.DOESNT_HANDLE_PROFILES === 'true';
const tracingMetrics = process.env.TRACING_METRICS !== 'false';

let discoveries = {};
const requests = {};
let receivedData = resetReceivedData();

// We usually do not activate morgan in the agent stub because it creates a lot of noise with little benefit. Activate
// it on demand if required.
// if (process.env.WITH_STDOUT) {
//   app.use(morgan(`Agent Stub (${process.pid}):\t:method :url :status`));
// }

app.use(
  bodyParser.json({
    limit: '10mb'
  })
);

app.use((req, res, next) => {
  res.set('server', 'Instana Agent');
  next();
});

app.get('/', (req, res) => {
  res.send('OK');
});

app.put('/com.instana.plugin.nodejs.discovery', (req, res) => {
  const pid = req.body.pid;
  discoveries[pid] = req.body;

  logger.debug('New discovery %s with params', pid, req.body);

  res.send({
    agentUuid: 'agent-stub-uuid',
    pid,
    extraHeaders,
    secrets: {
      matcher: secretsMatcher,
      list: secretsList
    }
  });
});

app.head(
  '/com.instana.plugin.nodejs.:pid',
  checkExistenceOfKnownPid(function handleAnnounceCheck(req, res) {
    logger.debug('Got announce check for PID %s', req.params.pid);
    res.send('OK');
  })
);

app.post(
  '/com.instana.plugin.nodejs.:pid',
  checkExistenceOfKnownPid(function handleEntityData(req, res) {
    if (!dropAllData) {
      receivedData.metrics.push({
        pid: parseInt(req.params.pid, 10),
        time: Date.now(),
        data: req.body
      });
      aggregateMetrics(req.params.pid, req.body);
    }

    const requestsForPid = requests[req.params.pid] || [];
    res.json(requestsForPid);
    delete requests[req.params.pid];
  })
);

app.post(
  '/com.instana.plugin.nodejs/traces.:pid',
  checkExistenceOfKnownPid(function handleTraces(req, res) {
    if (rejectTraces) {
      return res.sendStatus(400);
    }
    if (!dropAllData) {
      receivedData.traces.push({
        pid: parseInt(req.params.pid, 10),
        time: Date.now(),
        data: req.body
      });
    }
    if (logTraces) {
      /* eslint-disable no-console */
      console.log(JSON.stringify(req.body, null, 2));
      console.log('--\n');
    }
    res.send('OK');
  })
);

app.post(
  '/com.instana.plugin.nodejs/profiles.:pid',
  checkExistenceOfKnownPid(function handleProfiles(req, res) {
    if (doesntHandleProfiles) {
      return res.sendStatus(404);
    }
    if (!dropAllData) {
      receivedData.profiles.push({
        pid: parseInt(req.params.pid, 10),
        time: Date.now(),
        data: req.body
      });
    }
    if (logProfiles) {
      /* eslint-disable no-console */
      console.log(JSON.stringify(req.body, null, 2));
      console.log('--\n');
    }
    res.send('OK');
  })
);

app.post(
  '/com.instana.plugin.nodejs/response.:pid',
  checkExistenceOfKnownPid(function handleResponse(req, res) {
    if (!dropAllData) {
      receivedData.responses.push({
        pid: parseInt(req.params.pid, 10),
        time: Date.now(),
        messageId: req.query.messageId,
        data: req.body
      });
    }
    res.sendStatus(204);
  })
);

app.post('/tracermetrics', function handleTracermetrics(req, res) {
  if (!dropAllData) {
    receivedData.tracingMetrics.push(req.body);
  }
  if (!tracingMetrics) {
    res.sendStatus(404);
  } else {
    res.send('OK');
  }
});

app.post('/com.instana.plugin.generic.event', function postEvent(req, res) {
  if (!dropAllData) {
    receivedData.events.push(req.body);
  }
  res.send('OK');
});

app.post('/com.instana.plugin.generic.agent-monitoring-event', function postMonitoringEvent(req, res) {
  if (!dropAllData) {
    receivedData.monitoringEvents.push(req.body);
  }
  res.send('OK');
});

function checkExistenceOfKnownPid(fn) {
  return (req, res) => {
    const pid = req.params.pid;
    if (!discoveries[pid]) {
      logger.debug('Rejecting access for PID %s, not a known discovery', pid);
      return res.status(400).send(`Unknown discovery with pid: ${pid}`);
    }
    fn(req, res);
  };
}

app.get('/received/data', (req, res) => res.json(receivedData));

app.delete('/received/data', (req, res) => {
  receivedData = resetReceivedData();
  res.sendStatus(200);
});

app.get('/received/aggregated/metrics/:pid', (req, res) => res.json(receivedData.aggregatedMetrics[req.params.pid]));

app.get('/received/traces', (req, res) => res.json(receivedData.traces));

app.get('/received/profiles', (req, res) => res.json(receivedData.profiles));

app.get('/received/events', (req, res) => res.json(receivedData.events));

app.get('/received/monitoringEvents', (req, res) => res.json(receivedData.monitoringEvents));

app.get('/received/tracingMetrics', (req, res) => res.json(receivedData.tracingMetrics));

app.get('/discoveries', (req, res) => res.json(discoveries));

app.delete('/discoveries', (req, res) => {
  discoveries = {};
  res.send('OK');
});

app.post('/request/:pid', (req, res) => {
  requests[req.params.pid] = requests[req.params.pid] || [];
  requests[req.params.pid].push(req.body);
  res.send('OK');
});

app.listen(process.env.AGENT_PORT, () => {
  logger.info('Listening on port: %s', process.env.AGENT_PORT);
});

function aggregateMetrics(entityId, snapshotUpdate) {
  if (!receivedData.aggregatedMetrics[entityId]) {
    receivedData.aggregatedMetrics[entityId] = _.cloneDeep(snapshotUpdate);
  } else {
    deepMerge(receivedData.aggregatedMetrics[entityId], snapshotUpdate);
  }
}

function resetReceivedData() {
  return {
    metrics: [],
    aggregatedMetrics: {},
    traces: [],
    profiles: [],
    responses: [],
    events: [],
    monitoringEvents: [],
    tracingMetrics: []
  };
}
