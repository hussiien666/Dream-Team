import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','test/migration-auth.integration.mjs'],{env:{...process.env,RUN_REACT_BROWSER:'true',THROTTLE_LIMIT:'10000'},stdio:'inherit'});process.exitCode=result.status??1;
