
import fs from 'fs';

const files = [
  'public/data/opposed.json',
  'public/data/osmu.json',
  'public/data/palace.json'
];

files.forEach(file => {
  try {
    console.log(`Checking ${file}...`);
    const content = fs.readFileSync(file, 'utf8');
    JSON.parse(content);
    console.log(`${file} is valid JSON.`);
  } catch (e) {
    console.error(`Error in ${file}: ${e.message}`);
  }
});
