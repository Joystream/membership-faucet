import low from "lowdb";
import FileAsync from "lowdb/adapters/FileAsync";
// import { log } from './debug';

type Schema = {
};

const adapter = new FileAsync<Schema>("members-created.json");
const db = low(adapter);

export { 
  db,
  Schema,
};
