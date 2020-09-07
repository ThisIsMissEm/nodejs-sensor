set -ex
cp -R ../../../../../native-dep-packs/node_modules_alpine-12.18.3/event-loop-stats .
cp -R ../../../../../native-dep-packs/node_modules_alpine-12.18.3/gcstats.js .
cp -R ../../../../../native-dep-packs/node_modules_alpine-12.18.3/netlinkwrapper .
cp -R ../../../../../native-dep-packs/node_modules_alpine-12.18.3/@instana/autoprofile .
cat /dev/null > autoprofile/build/Release/autoprofile-addon.node
cat /dev/null > event-loop-stats/build/Release/eventLoopStats.node
cat /dev/null > gcstats.js/build/Release/gcstats.node
cat /dev/null > netlinkwrapper/build/Release/netlinksocket.node
tar -czf autoprofile-corrupt.tar.gz autoprofile
tar -czf event-loop-stats-corrupt.tar.gz event-loop-stats
tar -czf gcstats.js-corrupt.tar.gz gcstats.js
tar -czf netlinkwrapper-corrupt.tar.gz netlinkwrapper
rm -rf autoprofile event-loop-stats gcstats.js netlinkwrapper
