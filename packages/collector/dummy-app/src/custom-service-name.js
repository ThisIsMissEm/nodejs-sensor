'use strict';

const port = 2807;

const instana = require('../..')({
  level: 'info',
  serviceName: 'custom-service-name-inheritance-test',
  tracing: {
    automaticTracingEnabled: false
  }
});

const express = require('express');

const app = express();

app.get('/entry-intermediates-exit', (req, res) => {
  console.log(`${new Date()}: /entry-intermediates-exit`);
  instana.sdk.callback.startEntrySpan('sdk-entry', () => {
    setTimeout(() => {
      instana.sdk.callback.startIntermediateSpan('sdk-intermediate-1', () => {
        setTimeout(() => {
          instana.sdk.callback.startIntermediateSpan('sdk-intermediate-2', () => {
            setTimeout(() => {
              instana.sdk.callback.startIntermediateSpan('sdk-intermediate-3', () => {
                setTimeout(() => {
                  instana.sdk.callback.startExitSpan('sdk-exit', () => {
                    setTimeout(() => {
                      instana.sdk.callback.completeExitSpan();
                      instana.sdk.callback.completeIntermediateSpan();
                      instana.sdk.callback.completeIntermediateSpan();
                      instana.sdk.callback.completeIntermediateSpan();
                      res.send('OK');
                      instana.sdk.callback.completeEntrySpan();
                      // console.log(`${new Date()}: sending response`);
                    }, 50);
                  });
                }, 50);
              });
            }, 50);
          });
        }, 50);
      });
    }, 50);
  });
});

app.get('/parentless-exit', (req, res) => {
  console.log(`${new Date()}: /parentless-exit`);
  instana.sdk.callback.startExitSpan('sdk-exit-no-parent', () => {
    setTimeout(() => {
      instana.sdk.callback.completeExitSpan();
      res.send('OK');
      // console.log(`${new Date()}: sending response`);
    }, 50);
  });
});

app.get('/parentless-intermediates-exit', (req, res) => {
  console.log(`${new Date()}: /parentless-intermediates-exit`);
  instana.sdk.callback.startIntermediateSpan('sdk-intermediate-1', () => {
    setTimeout(() => {
      instana.sdk.callback.startIntermediateSpan('sdk-intermediate-2', () => {
        setTimeout(() => {
          instana.sdk.callback.startIntermediateSpan('sdk-intermediate-3', () => {
            setTimeout(() => {
              instana.sdk.callback.startExitSpan('sdk-exit', () => {
                setTimeout(() => {
                  instana.sdk.callback.completeExitSpan();
                  instana.sdk.callback.completeIntermediateSpan();
                  instana.sdk.callback.completeIntermediateSpan();
                  instana.sdk.callback.completeIntermediateSpan();
                  res.send('OK');
                  // console.log(`${new Date()}: sending response`);
                }, 50);
              });
            }, 50);
          });
        }, 50);
      });
    }, 50);
  });
});

app.listen(port, () => {
  console.log('Listening on port', port);
});
