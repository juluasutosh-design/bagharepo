console.log("myfile is running....");
const YAML = require('yaml');
const fs = require('fs');
const myArray = process.argv.slice(2)
console.log(myArray)
for ( const env of myArray ) {
  const file = fs.readFileSync(`deployment/aks/chart/${env}.values.yaml`,'utf8');
  const config = YAML.parse(file)
  console.log(config['julu-cname'].env);
};
console.log("passedimport step");
