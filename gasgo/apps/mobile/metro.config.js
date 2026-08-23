// Metro configurado para el monorepo: la app consume @gasgo/core directamente del workspace,
// que es el mismo paquete que usa el backend. Un solo motor de cálculo para los dos lados.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Nota: NO desactivamos la búsqueda jerárquica. npm anida algunas dependencias de Expo
// (p. ej. expo-modules-core dentro de node_modules/expo) y Metro debe poder encontrarlas.

module.exports = config;
