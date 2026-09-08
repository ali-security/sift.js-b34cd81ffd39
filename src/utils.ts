export type Key = string | number;
export type Comparator = (a, b) => boolean;
export const typeChecker = <TType>(type) => {
  const typeString = "[object " + type + "]";
  return function (value): value is TType {
    return getClassName(value) === typeString;
  };
};

const getClassName = (value) => Object.prototype.toString.call(value);

export const comparable = (value: any) => {
  if (value instanceof Date) {
    return value.getTime();
  } else if (isArray(value)) {
    return value.map(comparable);
  } else if (value && typeof value.toJSON === "function") {
    return value.toJSON();
  }

  return value;
};

export const coercePotentiallyNull = (value: any) =>
  value == null ? null : value;

export const isArray = typeChecker<Array<any>>("Array");
export const isObject = typeChecker<Object>("Object");
export const isFunction = typeChecker<Function>("Function");

const objectHasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Own-property check that ignores the prototype chain. Used everywhere a
 * query (or an object being tested) is enumerated so that properties coming
 * from a polluted `Object.prototype` are never picked up as queries,
 * operations, or values.
 */

export const hasOwnProperty = (item: any, key: any) =>
  item != null && objectHasOwnProperty.call(item, key);

export const isProperty = (item: any, key: any) => {
  return hasOwnProperty(item, key) && !isFunction(item[key]);
};
export const isVanillaObject = (value) => {
  return (
    value &&
    (value.constructor === Object ||
      value.constructor === Array ||
      value.constructor.toString() === "function Object() { [native code] }" ||
      value.constructor.toString() === "function Array() { [native code] }") &&
    !value.toJSON
  );
};

export const equals = (a, b) => {
  if (a == null && a == b) {
    return true;
  }
  if (a === b) {
    return true;
  }

  if (Object.prototype.toString.call(a) !== Object.prototype.toString.call(b)) {
    return false;
  }

  if (isArray(a)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0, { length } = a; i < length; i++) {
      if (!equals(a[i], b[i])) return false;
    }
    return true;
  } else if (isObject(a)) {
    if (Object.keys(a).length !== Object.keys(b).length) {
      return false;
    }
    for (const key in a) {
      if (!hasOwnProperty(a, key)) continue;
      if (!equals(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
};
