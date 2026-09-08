import {
  BaseOperation,
  EqualsOperation,
  Options,
  createTester,
  Tester,
  createQueryOperation,
  QueryOperation,
  Operation,
  Query,
  NamedGroupOperation,
  numericalOperation,
  containsOperation,
} from "./core";
import { Key, comparable, isFunction, isArray, hasOwnProperty } from "./utils";

class $Ne extends BaseOperation<any> {
  readonly propop = true;
  private _test: Tester;
  init() {
    this._test = createTester(this.params, this.options.compare);
  }
  reset() {
    super.reset();
    this.keep = true;
  }
  next(item: any) {
    if (this._test(item)) {
      this.done = true;
      this.keep = false;
    }
  }
}
// https://docs.mongodb.com/manual/reference/operator/query/elemMatch/
class $ElemMatch extends BaseOperation<Query<any>> {
  readonly propop = true;
  private _queryOperation: QueryOperation<any>;
  init() {
    if (!this.params || typeof this.params !== "object") {
      throw new Error(`Malformed query. $elemMatch must by an object.`);
    }
    this._queryOperation = createQueryOperation(
      this.params,
      this.owneryQuery,
      this.options,
    );
  }
  reset() {
    super.reset();
    this._queryOperation.reset();
  }
  next(item: any) {
    if (isArray(item)) {
      for (let i = 0, { length } = item; i < length; i++) {
        // reset query operation since item being tested needs to pass _all_ query
        // operations for it to be a success
        this._queryOperation.reset();

        const child = item[i];
        this._queryOperation.next(child, i, item, false);
        this.keep = this.keep || this._queryOperation.keep;
      }
      this.done = true;
    } else {
      this.done = false;
      this.keep = false;
    }
  }
}

class $Not extends BaseOperation<Query<any>> {
  readonly propop = true;
  private _queryOperation: QueryOperation<any>;
  init() {
    this._queryOperation = createQueryOperation(
      this.params,
      this.owneryQuery,
      this.options,
    );
  }
  reset() {
    super.reset();
    this._queryOperation.reset();
  }
  next(item: any, key: Key, owner: any, root: boolean) {
    this._queryOperation.next(item, key, owner, root);
    this.done = this._queryOperation.done;
    this.keep = !this._queryOperation.keep;
  }
}

export class $Size extends BaseOperation<any> {
  readonly propop = true;
  init() {}
  next(item) {
    if (isArray(item) && item.length === this.params) {
      this.done = true;
      this.keep = true;
    }
    // if (parent && parent.length === this.params) {
    //   this.done = true;
    //   this.keep = true;
    // }
  }
}

const assertGroupNotEmpty = (values: any[]) => {
  if (values.length === 0) {
    throw new Error(`$and/$or/$nor must be a nonempty array`);
  }
};

class $Or extends BaseOperation<any> {
  readonly propop = false;
  private _ops: Operation<any>[];
  init() {
    assertGroupNotEmpty(this.params);
    this._ops = this.params.map((op) =>
      createQueryOperation(op, null, this.options),
    );
  }
  reset() {
    this.done = false;
    this.keep = false;
    for (let i = 0, { length } = this._ops; i < length; i++) {
      this._ops[i].reset();
    }
  }
  next(item: any, key: Key, owner: any) {
    let done = false;
    let success = false;
    for (let i = 0, { length } = this._ops; i < length; i++) {
      const op = this._ops[i];
      op.next(item, key, owner);
      if (op.keep) {
        done = true;
        success = op.keep;
        break;
      }
    }

    this.keep = success;
    this.done = done;
  }
}

class $Nor extends $Or {
  readonly propop = false;
  next(item: any, key: Key, owner: any) {
    super.next(item, key, owner);
    this.keep = !this.keep;
  }
}

class $In extends BaseOperation<any> {
  readonly propop = true;
  private _testers: Tester[];
  init() {
    const params = Array.isArray(this.params) ? this.params : [this.params];
    this._testers = params.map((value) => {
      if (containsOperation(value, this.options)) {
        throw new Error(`cannot nest $ under ${this.name.toLowerCase()}`);
      }
      return createTester(value, this.options.compare);
    });
  }
  next(item: any, key: Key, owner: any) {
    let done = false;
    let success = false;
    for (let i = 0, { length } = this._testers; i < length; i++) {
      const test = this._testers[i];
      if (test(item)) {
        done = true;
        success = true;
        break;
      }
    }

    this.keep = success;
    this.done = done;
  }
}

class $Nin extends BaseOperation<any> {
  readonly propop = true;
  private _in: $In;
  constructor(params: any, ownerQuery: any, options: Options, name: string) {
    super(params, ownerQuery, options, name);
    this._in = new $In(params, ownerQuery, options, name);
  }
  next(item: any, key: Key, owner: any, root: boolean) {
    this._in.next(item, key, owner);

    if (isArray(owner) && !root) {
      if (this._in.keep) {
        this.keep = false;
        this.done = true;
      } else if (key == owner.length - 1) {
        this.keep = true;
        this.done = true;
      }
    } else {
      this.keep = !this._in.keep;
      this.done = true;
    }
  }
  reset() {
    super.reset();
    this._in.reset();
  }
}

class $Exists extends BaseOperation<boolean> {
  readonly propop = true;
  next(item: any, key: Key, owner: any, root: boolean, leaf?: boolean) {
    if (!leaf) {
      this.done = true;
      this.keep = !this.params;
    } else if (hasOwnProperty(owner, key) === this.params) {
      this.done = true;
      this.keep = true;
    }
  }
}

class $And extends NamedGroupOperation {
  readonly propop = false;
  constructor(
    params: Query<any>[],
    owneryQuery: Query<any>,
    options: Options,
    name: string,
  ) {
    super(
      params,
      owneryQuery,
      options,
      params.map((query) => createQueryOperation(query, owneryQuery, options)),
      name,
    );

    assertGroupNotEmpty(params);
  }
  next(item: any, key: Key, owner: any, root: boolean) {
    this.childrenNext(item, key, owner, root);
  }
}

class $All extends NamedGroupOperation {
  readonly propop = true;
  constructor(
    params: Query<any>[],
    owneryQuery: Query<any>,
    options: Options,
    name: string,
  ) {
    super(
      params,
      owneryQuery,
      options,
      params.map((query) => createQueryOperation(query, owneryQuery, options)),
      name,
    );
  }
  next(item: any, key: Key, owner: any, root: boolean) {
    this.childrenNext(item, key, owner, root);
  }
}

export const $eq = (params: any, owneryQuery: Query<any>, options: Options) =>
  new EqualsOperation(params, owneryQuery, options);
export const $ne = (
  params: any,
  owneryQuery: Query<any>,
  options: Options,
  name: string,
) => new $Ne(params, owneryQuery, options, name);
export const $or = (
  params: Query<any>[],
  owneryQuery: Query<any>,
  options: Options,
  name: string,
) => new $Or(params, owneryQuery, options, name);
export const $nor = (
  params: Query<any>[],
  owneryQuery: Query<any>,
  options: Options,
  name: string,
) => new $Nor(params, owneryQuery, options, name);
export const $elemMatch = (
  params: any,
  owneryQuery: Query<any>,
  options: Options,
  name: string,
) => new $ElemMatch(params, owneryQuery, options, name);
export const $nin = (
  params: any,
  owneryQuery: Query<any>,
  options: Options,
  name: string,
) => new $Nin(params, owneryQuery, options, name);
export const $in = (
  params: any,
  owneryQuery: Query<any>,
  options: Options,
  name: string,
) => {
  return new $In(params, owneryQuery, options, name);
};

export const $lt = numericalOperation((params) => (b) => {
  return b != null && b < params;
});
export const $lte = numericalOperation((params) => (b) => {
  return b === params || b <= params;
});
export const $gt = numericalOperation((params) => (b) => {
  return b != null && b > params;
});
export const $gte = numericalOperation((params) => (b) => {
  return b === params || b >= params;
});
export const $mod = (
  [mod, equalsValue]: number[],
  owneryQuery: Query<any>,
  options: Options,
) =>
  new EqualsOperation(
    (b) => comparable(b) % mod === equalsValue,
    owneryQuery,
    options,
  );
export const $exists = (
  params: boolean,
  owneryQuery: Query<any>,
  options: Options,
  name: string,
) => new $Exists(params, owneryQuery, options, name);
export const $regex = (
  pattern: string,
  owneryQuery: Query<any>,
  options: Options,
) =>
  new EqualsOperation(
    // $options is only honored when it sits on the query itself - an inherited
    // one may come from a polluted prototype.
    new RegExp(
      pattern,
      hasOwnProperty(owneryQuery, "$options")
        ? (owneryQuery as any).$options
        : undefined,
    ),
    owneryQuery,
    options,
  );
export const $not = (
  params: any,
  owneryQuery: Query<any>,
  options: Options,
  name: string,
) => new $Not(params, owneryQuery, options, name);

const typeAliases = {
  number: (v) => typeof v === "number",
  string: (v) => typeof v === "string",
  bool: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
  timestamp: (v) => v instanceof Date,
};

export const $type = (
  clazz: Function | string,
  owneryQuery: Query<any>,
  options: Options,
) =>
  new EqualsOperation(
    (b) => {
      if (typeof clazz === "string") {
        if (!typeAliases[clazz]) {
          throw new Error(`Type alias does not exist`);
        }

        return typeAliases[clazz](b);
      }

      return b != null ? b instanceof clazz || b.constructor === clazz : false;
    },
    owneryQuery,
    options,
  );
export const $and = (
  params: Query<any>[],
  ownerQuery: Query<any>,
  options: Options,
  name: string,
) => new $And(params, ownerQuery, options, name);

export const $all = (
  params: Query<any>[],
  ownerQuery: Query<any>,
  options: Options,
  name: string,
) => new $All(params, ownerQuery, options, name);
export const $size = (
  params: number,
  ownerQuery: Query<any>,
  options: Options,
) => new $Size(params, ownerQuery, options, "$size");
export const $options = () => null;

// `process.env.CSP_ENABLED` is swapped for `true` when the CSP bundle is built,
// so it has to stay written out verbatim here. Both reads go through try/catch
// because `process` is not defined at all in a browser - the CSP bundle still
// reports CSP mode there, and the regular bundle reports "not enabled" instead
// of throwing a ReferenceError.

const isCspEnabled = () => {
  try {
    return !!process.env.CSP_ENABLED;
  } catch (e) {
    return false;
  }
};

const isStringWhereAllowed = () => {
  try {
    return !!process.env.SIFT_ALLOW_STRING_WHERE;
  } catch (e) {
    return false;
  }
};

export const $where = (
  params: string | Function,
  ownerQuery: Query<any>,
  options: Options,
) => {
  let test;

  if (isFunction(params)) {
    test = params;
  } else if (isCspEnabled()) {
    throw new Error(
      `In CSP mode, sift does not support strings in "$where" condition`,
    );
  } else if (!isStringWhereAllowed()) {
    // Strings given to "$where" are compiled with `new Function`, so a query
    // that comes from an untrusted source - or from a polluted prototype -
    // would be able to run arbitrary code. Only functions are accepted by
    // default; setting the SIFT_ALLOW_STRING_WHERE environment variable opts
    // back into compiling strings.
    throw new Error(
      `sift does not support strings in "$where" condition by default. ` +
        `Use a function instead, or set the SIFT_ALLOW_STRING_WHERE ` +
        `environment variable to allow compiling strings.`,
    );
  } else {
    test = new Function("obj", "return " + params);
  }

  return new EqualsOperation((b) => test.bind(b)(b), ownerQuery, options);
};
