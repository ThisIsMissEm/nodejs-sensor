'use strict';

const opentracing = require('opentracing');
const spanBuffer = require('../spanBuffer');
const tracingUtil = require('../tracingUtil');

// can be set via config
let serviceName;

let processIdentityProvider = null;

function Span(tracer, name, fields) {
  opentracing.Span.call(this);
  this.tracerImpl = tracer;

  let parentContext;
  if (fields && fields.references) {
    for (let i = 0, length = fields.references.length; i < length; i++) {
      const reference = fields.references[i];

      if (
        reference.type() === opentracing.REFERENCE_CHILD_OF ||
        reference.type() === opentracing.REFERENCE_FOLLOWS_FROM
      ) {
        parentContext = reference.referencedContext();
      }
    }
  }

  const spanId = tracingUtil.generateRandomSpanId();
  const traceId = (parentContext ? parentContext.t : null) || spanId;
  const parentId = (parentContext ? parentContext.s : null) || undefined;
  this._contextImpl = new opentracing.SpanContext();
  this._contextImpl.s = spanId;
  this._contextImpl.t = traceId;
  this._contextImpl.baggage = copyBaggage(parentContext && parentContext.baggage);
  this._contextImpl.samplingPriority = parentContext ? parentContext.samplingPriority : 1;

  this.span = {
    s: spanId,
    t: traceId,
    p: parentId,
    ec: 0,
    ts: (fields ? fields.startTime : null) || Date.now(),
    d: 0,
    n: 'sdk',
    stack: tracingUtil.getStackTrace(Span),
    data: {
      service: serviceName,
      sdk: {
        type: 'local',
        name,
        custom: {
          tags: {},
          logs: {}
        }
      }
    }
  };

  if (processIdentityProvider && typeof processIdentityProvider.getFrom === 'function') {
    this.span.f = processIdentityProvider.getFrom();
  }

  if (fields && fields.tags) {
    this._addTags(fields.tags);
  }

  if (fields && fields.operationName) {
    this.span.data.sdk.name = fields.operationName;
  }
}

module.exports = exports = Span;

Span.prototype = Object.create(opentracing.Span.prototype);

Span.prototype._context = function _context() {
  return this._contextImpl;
};

Span.prototype._tracer = function _tracer() {
  return this.tracerImpl;
};

Span.prototype._setOperationName = function _setOperationName(name) {
  this.span.data.sdk.name = name;
};

Span.prototype._setBaggageItem = function _setBaggageItem(key, value) {
  this._contextImpl.baggage[key] = value;
};

Span.prototype._getBaggageItem = function _getBaggageItem(key) {
  return this._contextImpl.baggage[key];
};

Span.prototype._addTags = function _addTags(keyValuePairs) {
  const keys = Object.keys(keyValuePairs);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    this._addTag(key, keyValuePairs[key]);
  }
};

Span.prototype._addTag = function _addTag(key, value) {
  if (key === opentracing.Tags.ERROR) {
    if (value) {
      this.span.ec = 1;
    }
  } else if (key === opentracing.Tags.SPAN_KIND) {
    if (value === opentracing.Tags.SPAN_KIND_RPC_SERVER || value === 'consumer') {
      this.span.data.sdk.type = 'entry';
    } else if (value === opentracing.Tags.SPAN_KIND_RPC_CLIENT || value === 'producer') {
      this.span.data.sdk.type = 'exit';
    }
  } else if (key === opentracing.Tags.SAMPLING_PRIORITY) {
    this._contextImpl.samplingPriority = value;
  } else {
    this.span.data.sdk.custom.tags[key] = value;
  }
};

Span.prototype._log = function _log(keyValuePairs, timestamp) {
  if (timestamp == null) {
    timestamp = Date.now();
  }

  let timestampData = this.span.data.sdk.custom.logs[timestamp];
  if (!timestampData) {
    timestampData = this.span.data.sdk.custom.logs[timestamp] = {};
  }

  const keys = Object.keys(keyValuePairs);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    timestampData[key] = keyValuePairs[key];
  }
};

Span.prototype._finish = function _finish(finishTime) {
  if (this._contextImpl.samplingPriority <= 0) {
    return;
  }

  if (finishTime == null) {
    finishTime = Date.now();
  }
  this.span.d = Math.max(0, finishTime - this.span.ts);
  spanBuffer.addSpan(this.span);
};

function copyBaggage(baggage) {
  if (!baggage) {
    return {};
  }

  const copy = {};

  const keys = Object.keys(baggage);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    copy[key] = baggage[key];
  }

  return copy;
}

exports.init = function init(config, _processIdentityProvider) {
  if (config.serviceName) {
    serviceName = config.serviceName;
  }
  processIdentityProvider = _processIdentityProvider;
};

exports.setProcessIdentityProvider = function setProcessIdentityProvider(fn) {
  processIdentityProvider = fn;
};
