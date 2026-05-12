const YAML = require('yaml');
const fs = require('fs');

let yamlFile = process.argv[3].split(',')
let input = process.argv[2]
// const configPath = './config.yml';
// const configText = fs.readFileSync(configPath, 'utf8');
// const configDoc = YAML.parseDocument(configText);
parseYamlFile(yamlFile,input);
// console.log(configDoc.toJS());
function parseYamlFile(yamlFile, input) {
    for (let file of yamlFile) {
        let filePath = `./deployment/aks/chart/${file}.values.yaml`;
        let configText = fs.readFileSync(filePath, 'utf8');
        let configDoc = YAML.parseDocument(configText);
        console.log(`Processing file: ${filePath}`);
        let patchDoc = YAML.parseDocument(input);
        console.log('Parsed patch document:', patchDoc.toJS());
        mergeIntoMap(configDoc.contents, patchDoc.contents);
        fs.writeFileSync(filePath, String(configDoc), 'utf8');
    }
}
//expect user to give last parent and key to update the value of last parent in yaml file
// let input = `
// niq-deploy:
//   ingress:
//     # -- Ingress Path
//     path: /(.*)
//     # -- DNS Zone for Ingress
//     dnsZone: "azure-papinpus-np.nielsencsp.net"
//     tls:
//       # -- Enable tls for HTTPS
//       enabled: false
//     hostName: 
//     - "julus-test-app-1" #domain
//     - "julus-test-app2" #domain
//     # separate domain
//     - 'sibun-bhalu-app3' #domain sibun`;

// const patchDoc = YAML.parseDocument(input);

// console.log(patchDoc.toJS());
// console.log(typeof(configDoc.contents));

// function isObject(value) {
//   return value !== null && typeof value === 'object' && !Array.isArray(value);
// }

function mergeIntoMap(mapNode, patchMapNode) {
  for (const patchPair of patchMapNode.items) {
    console.log('Processing patch pair:', patchPair);
    const key = patchPair.key && patchPair.key.value;
    console.log('Patch key:', key);
    const existingPair = mapNode.items.find((item) => item.key && item.key.value === key);
    console.log('Existing pair:', existingPair);

    if (!existingPair) {
      mapNode.items.push(patchPair.clone());
      continue;
    }

    // If patch has pair-level comments/spacers, carry them over.
    // if (patchPair.commentBefore != null) {
    //     console.log('Updating commentBefore for key:', key);
    //   existingPair.commentBefore = patchPair.commentBefore;
    // }
    // if (patchPair.comment != null) {
    //   console.log('Updating comment for key:', key);
    //   existingPair.comment = patchPair.comment;
    // }
    // if (patchPair.spaceBefore != null) {
    //   console.log('Updating spaceBefore for key:', key);
    //   existingPair.spaceBefore = patchPair.spaceBefore;
    // }

    const existingValue = existingPair.value;
    const patchValue = patchPair.value;

    if (YAML.isMap(existingValue) && YAML.isMap(patchValue)) {
      mergeIntoMap(existingValue, patchValue);
      continue;
    }
    existingPair.value = patchValue.clone();
  }
}

// if (!YAML.isMap(configDoc.contents)) {
//   throw new Error('config.yml root must be a YAML map/object.');
// }

// if (!YAML.isMap(patchDoc.contents)) {
//   throw new Error('Input patch must be a YAML map/object.');
// }



