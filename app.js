const YAML = require('yaml');
const fs = require('fs');

// const configPath = './bedoreConfig.yml';
// const outputPath = './Afterconfig.yml';
// const configText = fs.readFileSync(configPath, 'utf8');
// const configDoc = YAML.parseDocument(configText);

// Input format: parent~child~child2~value;parent~child2~child3~value


function parseInput(raw) {
	const updates = [];
    if (raw.includes(';') === false) {
        console.error(`The input "${raw}" does not contain the delimiter ";",exiting....`)
        process.exit(1);
    }
    console.log(`Parsing input: ${raw.split(';')}`);
	for (const segment of raw.split(';')) {
		const trimmed = segment.trim();
		if (!trimmed) {
			continue;
		}
        console.log(`Processing segment: ${trimmed}`);
        if (String(trimmed.split('~')) === trimmed){
            console.error(`The string "${trimmed}" does not contain the delimiter "~",exiting....`)
            process.exit(1);
        }
		const parts = trimmed
			.split('~')
			.map((part) => part.trim())
			.filter(Boolean);

		if (parts.length < 2) {
			throw new Error(`Invalid input segment: ${trimmed}`);
		}

		const valueText = parts.pop();
		updates.push({
			path: parts,
			value: YAML.parse(valueText)
		});
	}

	return updates;
}

function findPairInMap(mapNode, key) {
	const getPairKey = (pair) => {
		if (YAML.isScalar(pair.key)) {
			return String(pair.key.value);
		}

		if (
			typeof pair.key === 'string' ||
			typeof pair.key === 'number' ||
			typeof pair.key === 'boolean'
		) {
			return String(pair.key);
		}

		return null;
	};

	return mapNode.items.find(
		(pair) => getPairKey(pair) === key
	);
}

function isArraySegment(segment) {
	return segment.startsWith('[') && segment.endsWith(']');
}

function getArraySegmentKey(segment) {
	return segment.slice(1, -1).trim();
}

function getArraySegmentKeys(segment) {
	return getArraySegmentKey(segment)
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

function findPairRecursive(node, key ) {
	if (YAML.isMap(node)) {
		const found = findPairInMap(node, key);
		if (found) {
            console.log(`Found pair for key: ${key}`);
			return { ownerMap: node, pair: found };
		}

		for (const pair of node.items) {
			const childKey = YAML.isScalar(pair.key) ? pair.key.value : String(pair.key);
			console.log(`Descending into YAML Child with key: ${childKey}`);
			const nested = findPairRecursive(pair.value, key, pair.key.value);
			if (nested) {
				return nested;
			}
		}
	}

	if (YAML.isSeq(node)) {
		for (const item of node.items) {
			const nested = findPairRecursive(item, key);
			if (nested) {
				return nested;
			}
		}
	}

	return null;
}

function ensureMapForPair(pair, doc) {
	if (!YAML.isMap(pair.value)) {
		const previousValue = pair.value;
		const newMap = doc.createNode({});

		if (previousValue) {
			newMap.comment = previousValue.comment;
			newMap.commentBefore = previousValue.commentBefore;
			newMap.spaceBefore = previousValue.spaceBefore;
		}

		pair.value = newMap;
	}
	return pair.value;
}

function ensureSeqForPair(pair, doc) {
	if (!YAML.isSeq(pair.value)) {
		const previousValue = pair.value;
		const newSeq = doc.createNode([]);

		if (previousValue) {
			newSeq.comment = previousValue.comment;
			newSeq.commentBefore = previousValue.commentBefore;
			newSeq.spaceBefore = previousValue.spaceBefore;
		}

		pair.value = newSeq;
	}

	return pair.value;
}

function findPairInSeqItem(seqNode, key) {
	return seqNode.items.find((item) => YAML.isMap(item) && findPairInMap(item, key));
}

function ensureSeqChildMapPair(seqNode, key, doc) {
	let childMap = seqNode.items.find((item) => YAML.isMap(item) && findPairInMap(item, key));

	if (childMap) {
		return findPairInMap(childMap, key);
	}

	if (seqNode.items.length > 0 && YAML.isMap(seqNode.items[0])) {
		childMap = seqNode.items[0];
	} else {
		childMap = doc.createNode({});
		seqNode.items.push(childMap);
	}

	let childPair = findPairInMap(childMap, key);
	if (!childPair) {
		childPair = new YAML.Pair(doc.createNode(key), doc.createNode({}));
		childMap.items.push(childPair);
	}

	return childPair;
}

function appendSeqMapItem(seqNode, key, valueNode, doc) {
	const mapNode = doc.createNode({});
	mapNode.items.push(new YAML.Pair(doc.createNode(key), valueNode));
	seqNode.items.push(mapNode);
	return mapNode;
}

function setPairValuePreservingComments(pair, value, doc) {
	const previousValue = pair.value;
    console.log(`inital value is ${previousValue}, Setting value for key ${pair.key} to ${value}`);
	if (YAML.stringify(previousValue) === YAML.stringify(value)) {
        console.log(`Value for key ${pair.key} is already up to date, skipping update.`);
        return;
    }
    const nextValue = doc.createNode(value);
    console.log(`Created new node for value: ${YAML.stringify(nextValue)}`);

	if (previousValue) {
		nextValue.comment = previousValue.comment;
		nextValue.commentBefore = previousValue.commentBefore;
		nextValue.spaceBefore = previousValue.spaceBefore;
	}

	pair.value = nextValue;
}

function appendPair(mapNode, key, valueNode, doc) {
    console.log(`Key not found, Appending new pair with key: ${key} and value: ${valueNode}`);
	const keyNode = doc.createNode(key);
	const newPair = new YAML.Pair(keyNode, valueNode);
	mapNode.items.push(newPair);
	return newPair;
}

function findAppendTarget(rootMap) {
	// When a key is missing, don't append at the document root.
	// Descend into the first root value that is a map (e.g. niq-deploy's children)
	// so the new key lands inside the application config, not alongside it.
	for (const rootPair of rootMap.items) {
		if (YAML.isMap(rootPair.value)) {
			return rootPair.value;
		}
	}
	return rootMap;
}

function applyPathUpdate(rootMap, path, value, doc) {
	const [firstKey, ...restKeys] = path;
	let first = findPairRecursive(rootMap, firstKey);
	if (!first) {
        console.log(`Key not found : ${firstKey}. Going down the Yaml Tree`);
		const appendTarget = findAppendTarget(rootMap);
		const newFirst = appendPair(appendTarget, firstKey, doc.createNode({}), doc);
		first = { ownerMap: appendTarget, pair: newFirst };
        console.log('first',first.pair.key)
	}
	let currentPair = first.pair;

	if (restKeys.length === 0) {
		setPairValuePreservingComments(currentPair, value, doc);
		return;
	}
    // console.log(`current`,currentPair);
	for (let i = 0; i < restKeys.length; i += 1) {
		const key = restKeys[i];
		const isLast = i === restKeys.length - 1;
        console.log(`Processing child key: ${key}`);

		if (isArraySegment(key)) {
			const arrayKeys = getArraySegmentKeys(key);
			const currentSeq = ensureSeqForPair(currentPair, doc);
			for (const arrayKey of arrayKeys) {
				let arrayItem = findPairInSeqItem(currentSeq, arrayKey);

				if (!arrayItem) {
					arrayItem = appendSeqMapItem(
						currentSeq,
						arrayKey,
						isLast ? doc.createNode(value) : doc.createNode({}),
						doc
					);
				} else {
					const arrayItemPair = findPairInMap(arrayItem, arrayKey);
					if (isLast) {
						setPairValuePreservingComments(arrayItemPair, value, doc);
					} else {
						ensureMapForPair(arrayItemPair, doc);
					}
				}
			}

			currentPair = null;
			continue;
		}

		if (YAML.isSeq(currentPair.value)) {
			const currentSeq = currentPair.value;
			let seqChildPair = ensureSeqChildMapPair(currentSeq, key, doc);

			if (isLast) {
				setPairValuePreservingComments(seqChildPair, value, doc);
			} else {
				ensureMapForPair(seqChildPair, doc);
			}

			currentPair = seqChildPair;
			continue;
		}

		const currentMap = ensureMapForPair(currentPair, doc);

		let nextPair = findPairInMap(currentMap, key);
        console.log(`key ${key}:`, nextPair === undefined ? `not found` : `found value ${YAML.stringify(nextPair.value)}`);
		if (!nextPair) {
			nextPair = appendPair(
				currentMap,
				key,
				isLast ? doc.createNode(value) : doc.createNode({}),
				doc
			);
		} else if (isLast) {
            if( YAML.stringify(nextPair.value) === YAML.stringify(value) ){
                console.log(`Value for key ${key} is already up to date, skipping update.`);
            }
            else{
                console.log(`Updating value for key ${key} to ${value}`);
                setPairValuePreservingComments(nextPair, value, doc);
            }
        }

        else if (!isLast) {
            console.log(`Descending into next pair with key: ${restKeys[i+1]}`);
        }
		currentPair = nextPair;
	}
}
function main() {
	const updates = parseInput(process.env.OVERRIDE_YAML);

	for (const update of updates) {
        console.log(`Applying update key and value: ${update.path.join(':')} and ${update.value}`);
        if (process.env.CONFIG_FILE_TYPE === 'cname') {
            console.log(`Proceeding with cname files update...`);
            for (let env of process.env.ENVIRONMENT_FILES.split(',')) {
                console.log(`Processing environment: ${env}`);
                let configPath = `./deployment/aks/chart/cname/${env}.values.yaml`;
                let configText = fs.readFileSync(configPath, 'utf8');
                let configDoc = YAML.parseDocument(configText);
                applyPathUpdate(configDoc.contents, update.path, update.value, configDoc);
                fs.writeFileSync(configPath, String(configDoc), 'utf8');
                console.log(`Updated YAML written to ${configPath}`);
             }
            }
        else if (process.env.CONFIG_FILE_TYPE === 'deploy') {
            console.log(`Proceeding with deploy files update...`);
            for (let env of process.env.ENVIRONMENT_FILES.split(',')) {
                console.log(`Processing environment: ${env}`);
                let configPath = `./deployment/aks/chart/${env}.values.yaml`;
                let configText = fs.readFileSync(configPath, 'utf8');
                let configDoc = YAML.parseDocument(configText);
                applyPathUpdate(configDoc.contents, update.path, update.value, configDoc);
                fs.writeFileSync(configPath, String(configDoc), 'utf8');
                console.log(`Updated YAML written to ${configPath}`);
             }
            }
        else {
            console.error(`Unknown CONFIG_FILE_TYPE: ${process.env.CONFIG_FILE_TYPE}. Expected 'cname' or 'deploy'. Exiting...`);
        }
    }
}
main();

