const YAML = require('yaml');
const fs = require('fs');
for ( const env of process.env.envArray ) {
  try {
  const file = YAML.parse(fs.readFileSync(`./deployment/aks/chart/process.env.${yaml}`));
  console.log(file.julu-cname.env);
  
}
  catch error(e) {
    console.log("No such valid env Selected in Actions Input");
  }
};
    
