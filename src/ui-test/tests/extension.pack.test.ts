/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License", destination); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { expect } from 'chai';
import * as fs from 'fs';
import { getExtensionPackMetadata, getInstalledExtensionMetadata, getInstalledExtensionPath } from '../utils'

describe('Extension Pack for Apache Camel', function () {
    this.timeout(60000);
    this.slow(10000);
    const extensionMetadata: { [key: string]: any } = getExtensionPackMetadata();
    const extensionId = `${extensionMetadata['publisher']}.${extensionMetadata['name']}`;
    const metadataChecks = [
        { title: 'author', key: 'author' },
        { title: 'title', key: 'displayName' },
        { title: 'description', key: 'description' },
        { title: 'version', key: 'version' }
    ];

    it('Extension Pack is installed', async function () {
        expect(fs.existsSync(getInstalledExtensionPath(extensionId))).to.be.true;
    });

    metadataChecks.forEach(({ title, key }) => {
        it(`Has correct ${title}`, function () {
            expect(getInstalledExtensionMetadata(extensionId)[key]).to.be.equal(extensionMetadata[key]);
        });
    });

});
