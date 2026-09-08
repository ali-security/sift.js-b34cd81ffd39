const assert = require("assert");
const {
  default: sift,
  createQueryTester,
  ...defaultOperations
} = require("../lib");

const CANARY = "__siftPollutionCanary";

// Runs fn with a canary installed on the global object. The canary flips a
// flag when it gets called, which is how the tests below detect that a query
// string was compiled & executed by sift.
const withCanary = (fn) => {
  const state = { executed: false };
  global[CANARY] = function () {
    state.executed = true;
    return true;
  };
  try {
    fn(state);
  } finally {
    delete global[CANARY];
  }
  return state;
};

// Pollutes Object.prototype for the duration of fn, and always restores it.
const withPollutedPrototype = (key, value, fn) => {
  Object.prototype[key] = value;
  try {
    return fn();
  } finally {
    delete Object.prototype[key];
  }
};

const withStringWhereAllowed = (fn) => {
  const previous = process.env.SIFT_ALLOW_STRING_WHERE;
  process.env.SIFT_ALLOW_STRING_WHERE = "1";
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.SIFT_ALLOW_STRING_WHERE;
    } else {
      process.env.SIFT_ALLOW_STRING_WHERE = previous;
    }
  }
};

// A naive deep merge - the classic prototype pollution gadget. Merging
// JSON.parse('{"__proto__": ...}') through it writes onto Object.prototype.
const merge = (target, source) => {
  for (const key in source) {
    if (source[key] && typeof source[key] === "object") {
      if (!target[key]) {
        target[key] = {};
      }
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
};

describe(__filename + "#", function () {
  describe("prototype pollution", function () {
    const items = [{ v: 1 }, { v: 2 }];

    it("does not execute a $where polluted through a merge gadget", function () {
      let result;

      const state = withCanary(function () {
        merge(
          {},
          JSON.parse('{"__proto__": {"$where": "global.' + CANARY + '()"}}'),
        );
        try {
          // a completely benign filter - nothing in this query is attacker
          // controlled, the payload only lives on Object.prototype.
          result = items.filter(sift({}));
        } finally {
          delete Object.prototype.$where;
        }
      });

      assert.equal(state.executed, false);
      assert.equal(Object.prototype.$where, undefined);
      assert.deepEqual(result, items);
    });

    it("does not execute an inherited string $where for an empty query", function () {
      let result;

      const state = withCanary(function () {
        result = withPollutedPrototype(
          "$where",
          "global." + CANARY + "()",
          function () {
            return items.filter(sift({}));
          },
        );
      });

      assert.equal(state.executed, false);
      assert.deepEqual(result, items);
    });

    it("does not call an inherited function $where for an empty query", function () {
      let called = false;

      const result = withPollutedPrototype(
        "$where",
        function () {
          called = true;
          return true;
        },
        function () {
          return items.filter(sift({}));
        },
      );

      assert.equal(called, false);
      assert.deepEqual(result, items);
    });

    it("does not execute an inherited string $where for a nested query", function () {
      let result;

      const state = withCanary(function () {
        result = withPollutedPrototype(
          "$where",
          "global." + CANARY + "()",
          function () {
            return [{ a: { b: 1 } }, { a: { b: 2 } }].filter(
              sift({ a: { b: 1 } }),
            );
          },
        );
      });

      assert.equal(state.executed, false);
      assert.deepEqual(result, [{ a: { b: 1 } }]);
    });

    it("does not execute an inherited string $where through createQueryTester", function () {
      let result;

      const state = withCanary(function () {
        result = withPollutedPrototype(
          "$where",
          "global." + CANARY + "()",
          function () {
            return items.filter(
              createQueryTester({}, { operations: defaultOperations }),
            );
          },
        );
      });

      assert.equal(state.executed, false);
      assert.deepEqual(result, items);
    });

    it("ignores inherited operations other than $where", function () {
      const result = withPollutedPrototype("$size", 100, function () {
        return items.filter(sift({}));
      });

      assert.deepEqual(result, items);
    });

    it("ignores inherited properties when building a query", function () {
      const result = withPollutedPrototype("v", 99, function () {
        return items.filter(sift({}));
      });

      assert.deepEqual(result, items);
    });

    it("still matches own properties when the prototype is polluted", function () {
      const result = withPollutedPrototype("v", 99, function () {
        return items.filter(sift({ v: 1 }));
      });

      assert.deepEqual(result, [{ v: 1 }]);
    });

    it("ignores an inherited $options when building a $regex", function () {
      const names = [{ name: "Frank" }, { name: "joe" }];

      const result = withPollutedPrototype("$options", "i", function () {
        return names.filter(sift({ name: { $regex: "^f" } }));
      });

      assert.deepEqual(result, []);
      assert.deepEqual(
        names.filter(sift({ name: { $regex: "^f", $options: "i" } })),
        [{ name: "Frank" }],
      );
    });
  });

  describe("$where", function () {
    const items = [{ v: 1 }, { v: 2 }];

    it("does not compile a string given directly in a query", function () {
      const state = withCanary(function () {
        assert.throws(function () {
          items.filter(sift({ $where: "global." + CANARY + "()" }));
        }, /does not support strings/);
      });

      assert.equal(state.executed, false);
    });

    it("does not compile a string given in a nested query", function () {
      const state = withCanary(function () {
        assert.throws(function () {
          items.filter(sift({ a: { $where: "global." + CANARY + "()" } }));
        }, /does not support strings/);
      });

      assert.equal(state.executed, false);
    });

    it("compiles strings when SIFT_ALLOW_STRING_WHERE is set", function () {
      withStringWhereAllowed(function () {
        assert.deepEqual(items.filter(sift({ $where: "this.v === 1" })), [
          { v: 1 },
        ]);
        assert.deepEqual(items.filter(sift({ $where: "obj.v === 1" })), [
          { v: 1 },
        ]);
      });
    });

    it("still reports CSP mode when CSP_ENABLED is set", function () {
      const previous = process.env.CSP_ENABLED;
      process.env.CSP_ENABLED = "1";
      try {
        assert.throws(function () {
          items.filter(sift({ $where: "this.v === 1" }));
        }, /In CSP mode/);
      } finally {
        if (previous === undefined) {
          delete process.env.CSP_ENABLED;
        } else {
          process.env.CSP_ENABLED = previous;
        }
      }
    });

    it("still accepts functions", function () {
      assert.deepEqual(
        items.filter(
          sift({
            $where: function () {
              return this.v === 1;
            },
          }),
        ),
        [{ v: 1 }],
      );
    });
  });
});
