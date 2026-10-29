#include <bits/stdc++.h>

#include <utility>
#define ll long long
using namespace std;


template <
	typename S,
	S (*Op)(S, S),
	S (*e)(),
	typename F,
	S (*mapping)(S, F),
	F (*composition)(F, F),
	F (*id)()
>
class LazySegment {
private:
	ll size;
	vector<S> tree;
	vector<F> subtree;


	S r_apply(ll l, ll r, F f_old, F f_new, ll depth, ll index) {
		subtree[index] = composition(f_old, subtree[index]);
		ll left = (index - (1 << depth)) * (size >> depth);
		ll right = left + (size >> depth);
		if (l >= r || r <= left || right <= l) return e();
		if (l <= left && right <= r) {
			subtree[index] = composition(f_new, subtree[index]);
			return mapping(tree[index], subtree[index]);
		}
		S ans = Op(r_apply(l, r, subtree[index], f_new, depth + 1, index << 1), r_apply(l, r, subtree[index], f_new, depth + 1, index << 1 | 1));
		subtree[index] = id();
		tree[index] = Op(mapping(tree[index << 1 | 1], subtree[index << 1 | 1]), mapping(tree[index << 1], subtree[index << 1]));
		return ans;
	}

	S Set(ll l, ll r, F f_old, S s_new, ll depth, ll index) {
		subtree[index] = composition(f_old, subtree[index]);
		ll left = (index - (1 << depth)) * (size >> depth);
		ll right = left + (size >> depth);
		if (l >= r || r <= left || right <= l) return e();
		if (l <= left && right <= r) {
			tree[index] = s_new; subtree[index] = id();
			return mapping(tree[index], subtree[index]);
		}
		S ans = Op(Set(l, r, subtree[index], s_new, depth + 1, index << 1), Set(l, r, subtree[index], s_new, depth + 1, index << 1 | 1));
		subtree[index] = id();
		tree[index] = Op(mapping(tree[index << 1 | 1], subtree[index << 1 | 1]), mapping(tree[index << 1], subtree[index << 1]));
		return ans;
	}

public:
	LazySegment(ll n) :
	size(bit_ceil(static_cast<unsigned int>(n))) {
		tree.resize(size * 2, e());
		subtree.resize(size * 2, id());
	}

	ll set(ll index, S s) {
		return Set(index, index + 1, id(), s, 0, 1);
	}

	void setall(const vector<ll>& v) {
		ll index = size;
		for (auto val : v) {
			tree[index++] = val;
		}
		for (ll i = size - 1; i > 0; i--) {
			tree[i] = Op(tree[i << 1], tree[i << 1 | 1]);
		}
	}

	ll apply(ll i, F f) {
		return range_apply(i, i + 1, f);
	}

	ll range_apply(ll l, ll r, F f) {
		return r_apply(l, r, id(), f, 0, 1);
	}

	ll query(ll l, ll r) {
		return range_apply(l, r, 1, 0);
	}
};

using S = long long;

S op(S a, S b) {
	return max(a, b);
}

int main() {
	ios::sync_with_stdio(false);
	cin.tie(nullptr);
	ll n = 1000000;
	LazySegment<ll, op, > s(n);
	for (ll i = 0; i < n; i++) {
		s.set(i, i);
	}
	for (ll i = 0; i < n; i++) {
		s.range_apply(1, 10, 1, 1);
	}
	cout << s.query(1, 3) << endl;
}