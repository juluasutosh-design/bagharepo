console.log("myfile is running....");
const YAML = require('yaml');
const fs = require('fs');
const myArray = process.argv[2].split(',');
const yamlVal = process.argv[3];
const absVal = process.argv[4];
console.log(myArray);
console.log(absVal);
console.log(yamlVal);
console.log(process.argv);
for ( const env of myArray ) {
  const file = fs.readFileSync(`deployment/aks/chart/${env}.values.yaml`,'utf8');
  const config = YAML.parse(file);
  console.log(config['julu-cname'][yamlVal]);
  console.log(config['julu-cname'].env);
  /*
  if ( process.argv.slice(4,5) === 'undefined' && ( process.argv.slice(4,5) ||  process.argv.slice(5,6) )) {
    
  }
  else if ( process.argv(3,4) && process.argv(4,5) ) {
    dot.dot(process.argv.slice(3,4)) = process.argv.slice(4,5);
  else {
    console.log("if you want to overwtite , Please provide both values & input yaml")
  }
*/  
};
console.log("passedimport step");

