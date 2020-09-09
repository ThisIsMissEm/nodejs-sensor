#!/usr/bin/env bash
set -eo pipefail

cd `dirname $BASH_SOURCE`

source ./build-and-copy-node-modules
buildAndCopyModules standard 6.17.1 48
buildAndCopyModules standard 8.17.0 57
buildAndCopyModules standard 10.22.0 64
buildAndCopyModules standard 12.18.3 68
buildAndCopyModules standard 14.9.0 81
buildAndCopyModules alpine 6.17.1 48
buildAndCopyModules alpine 8.17.0 57
buildAndCopyModules alpine 10.22.0 64
buildAndCopyModules alpine 12.18.3 68
buildAndCopyModules alpine 14.9.0 81

