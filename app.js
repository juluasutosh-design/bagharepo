const YAML = require('yaml');
const fs = require('fs');

// const configPath = './bedoreConfig.yml';
// const outputPath = './Afterconfig.yml';
// const configText = fs.readFileSync(configPath, 'utf8');
// const configDoc = YAML.parseDocument(configText);

// Input format: parent~child~child2~value;parent~child2~child3~value


function splitTopLevel(text, delimiter) {
	const out = [];
	let depth = 0;
	let current = '';

	for (const ch of text) {
		if (ch === '[') {
			depth += 1;
			current += ch;
			continue;
		}

		if (ch === ']') {
			depth -= 1;
			current += ch;
			continue;
		}

		if (ch === delimiter && depth === 0) {
			out.push(current.trim());
			current = '';
			continue;
		}

		current += ch;
	}

	if (current.trim()) {
		out.push(current.trim());
	}

	return out;
}

function isArraySegment(segment) {
	return typeof segment === 'string' && segment.startsWith('[') && segment.endsWith(']');
}

function getArraySegmentKeys(segment) {
	return splitTopLevel(segment.slice(1, -1), ',')
		.map((part) => part.trim())
		.filter(Boolean);
}

function mergeObject(target, source) {
	for (const [key, value] of Object.entries(source)) {
		if (
			value &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			target[key] &&
			typeof target[key] === 'object' &&
			!Array.isArray(target[key])
		) {
			mergeObject(target[key], value);
			continue;
		}

		target[key] = value;
	}

	return target;
}

function buildNestedObject(parts) {
	if (parts.length < 2) {
		throw new Error(`Invalid nested path: ${parts.join('~')}`);
	}

	if (parts.length === 2) {
		return { [parts[0]]: parseValueText(parts[1]) };
	}

	return { [parts[0]]: buildNestedObject(parts.slice(1)) };
}

function parseValueText(valueText) {
	const trimmed = valueText.trim();

	if (!isArraySegment(trimmed)) {
		return YAML.parse(trimmed);
	}

	const inner = trimmed.slice(1, -1).trim();
	if (!inner) {
		return [];
	}

	const semicolonParts = splitTopLevel(inner, ';');
	const hasNestedPairs = semicolonParts.some((part) => splitTopLevel(part, '~').length > 1);
	if (!hasNestedPairs) {
		return getArraySegmentKeys(trimmed).map((item) => YAML.parse(item));
	}

	const result = {};
	for (const nestedPart of semicolonParts) {
		const nestedTokens = splitTopLevel(nestedPart, '~');
		mergeObject(result, buildNestedObject(nestedTokens));
	}

	return result;
}

function parseInput(raw) {
	const updates = [];
    if (raw.includes(';') === false) {
        console.error(`The input "${raw}" does not contain the delimiter ";",exiting....`)
        process.exit(1);
    }
	const segments = splitTopLevel(raw, ';');
    console.log(`Parsing input: ${segments}`);
	for (const segment of segments) {
		const trimmed = segment.trim();
		if (!trimmed) {
			continue;
		}
        console.log(`Processing segment: ${trimmed}`);
		const parts = splitTopLevel(trimmed, '~')
			.map((part) => part.trim())
			.filter(Boolean);

        if (parts.length < 2){
            console.error(`The string "${trimmed}" does not contain the delimiter "~",exiting....`)
            process.exit(1);
        }

		const valueText = parts.pop();
		updates.push({
			path: parts,
			value: parseValueText(valueText)
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
	for (const item of seqNode.items) {
		if (YAML.isMap(item)) {
			const pair = findPairInMap(item, key);
			if (pair) {
				return pair;
			}
		}
	}
	return null;
}

function appendSeqMapItem(seqNode, key, valueNode, doc) {
	const itemMap = doc.createNode({});
	const keyNode = doc.createNode(key);
	const newPair = new YAML.Pair(keyNode, valueNode);
	itemMap.items.push(newPair);
	seqNode.items.push(itemMap);
	return newPair;
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
	let [firstKey, ...restKeys] = path;
	if (isArraySegment(firstKey)) {
		console.log(`First key ${firstKey} is an array segment. Expanding path updates.`);
		for (const key of getArraySegmentKeys(firstKey)) {
			applyPathUpdate(rootMap, [key, ...restKeys], value, doc);
		}
		return;
	}

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
		let key = restKeys[i];
		const isLast = i === restKeys.length - 1;
        console.log(`Processing child key: ${key}, ${typeof(key)}`);
		if (isArraySegment(key)) {
			console.log(`The key is an array, Converting from string to Array`);
			const currentSeq = ensureSeqForPair(currentPair, doc);
			let nextCurrentPair = null;

			for (const arrayKey of getArraySegmentKeys(key)) {
				let seqPair = findPairInSeqItem(currentSeq, arrayKey);
				if (!seqPair) {
					seqPair = appendSeqMapItem(
						currentSeq,
						arrayKey,
						isLast ? doc.createNode(value) : doc.createNode({}),
						doc
					);
				}

				if (isLast) {
					setPairValuePreservingComments(seqPair, value, doc);
				} else {
					ensureMapForPair(seqPair, doc);
				}

				nextCurrentPair = seqPair;
			}

			currentPair = nextCurrentPair;
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

