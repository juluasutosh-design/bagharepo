console.log("myfile is running....");
const YAML = require('yaml');
const fs = require('fs');
const myArray = process.env.envArray
console.log(myArray)
/*
for ( const env of myArray ) {
  const file = YAML.parse(fs.readFileSync(`./deployment/aks/chart/${env}.values.yaml`));
  console.log(file.julu-cname.env);
};
*/
console.log("passedimport step");
