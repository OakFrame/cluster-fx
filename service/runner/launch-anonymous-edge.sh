cp ./cluster-fx.lib.ts ./tmp/$UUID/cluster-fx.lib.ts
cp ./$SELECTOR.service.ts ./tmp/$UUID/$SELECTOR.service.ts
cd ./tmp/$UUID

node /Users/apollo/.npm-global/bin/ts-node $SELECTOR.service.ts
node /Users/apollo/.npm-global/bin/ts-node $SELECTOR.service.ts

cd ../../
rm -rf ./tmp/$UUID
