cd /instana
npm rebuild || echo "Warning: Rebuilding native add-ons for @instana/fargate failed. Monitoring the Fargate tasks will work nonetheless, but you will miss some Node.js metrcs (GC metrics, event loop metrics, ...). See https://www.instana.com/docs/ecosystem/aws-fargate/#build-dependencies-and-native-add-ons for details."

