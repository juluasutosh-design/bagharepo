const yaml = require('yaml');
const fs   = require('fs');


myObj = yaml.safeLoad(fs.readFileSync('./deployment/aks/chart/myfile.yml', 'utf8'));
console.log(myObj);
function setByPath(keyPath) {
  const segments = keyPath
    .split(".")
    .map((part) => part.trim());
    return segments
}

console.log(setByPath("a.b.c"))
