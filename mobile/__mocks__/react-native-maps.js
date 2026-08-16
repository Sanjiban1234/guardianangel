/**
 * Mock for react-native-maps — the native module is unavailable in the Jest
 * environment, so MapView/Marker/Polyline are stubbed as plain views.
 * See: https://github.com/react-native-maps/react-native-maps (jest setup docs)
 */

const React = require('react');
const { View } = require('react-native');

function createMockComponent(displayName) {
  function Component({ children, ...props }) {
    return React.createElement(View, { ...props }, children);
  }
  Component.displayName = displayName;
  Component.prototype.animateToRegion = jest.fn();
  Component.prototype.animateCamera = jest.fn();
  Component.prototype.fitToCoordinates = jest.fn();
  Component.prototype.fitToElements = jest.fn();
  return Component;
}

module.exports = {
  __esModule: true,
  default: createMockComponent('MapView'),
  MapView: createMockComponent('MapView'),
  Marker: createMockComponent('Marker'),
  Polyline: createMockComponent('Polyline'),
  Circle: createMockComponent('Circle'),
  PROVIDER_GOOGLE: 'google',
  PROVIDER_DEFAULT: 'default',
};
