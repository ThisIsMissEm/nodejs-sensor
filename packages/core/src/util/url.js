'use strict';

const secrets = require('../secrets');

exports.discardUrlParameters = function discardUrlParameters(url) {
  let index = getCharCountUntilOccurenceOfChar(url, '?');
  index = Math.min(index, getCharCountUntilOccurenceOfChar(url, '#'));
  index = Math.min(index, getCharCountUntilOccurenceOfChar(url, ';'));
  return url.substring(0, index);
};

function getCharCountUntilOccurenceOfChar(s, char) {
  const index = s.indexOf(char);
  return index === -1 ? s.length : index;
}

exports.filterParams = function filterParams(queryString) {
  if (!queryString || queryString === '') {
    return undefined;
  }
  if (typeof queryString !== 'string') {
    return queryString;
  }
  return queryString
    .split('&')
    .map(param => {
      const key = param.split('=')[0];
      if (key && secrets.isSecret(key)) {
        return `${key}=<redacted>`;
      }
      return param;
    })
    .join('&');
};
