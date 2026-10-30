#include <bits/stdc++.h>
#define ll long long


// --- [LazySegmentTree.cpp] ---
class LazySegment {
private:
	ll size;
	ll identity;
	vector<ll> bata;
	vector<ll> tree;
	vector<pair<ll, ll>> subtree;

	function<ll(ll a, ll b)> f;

	ll calculation(ll i, ll depth) {
		return tree[i] * subtree[i].first + subtree[i].second * bata[bata.size() - 1- depth];
	}

	ll composition(ll a, ll b, ll index) {
		subtree[index].first = subtree[index].first * a;
		subtree[index].second = subtree[index].second * a + b;
		return 0;
	}

	ll propagate(ll i) {
		ll a = subtree[i].first, b = subtree[i].second;
		composition(a, b, i << 1);
		composition(a, b, i << 1 | 1);
		subtree[i].first = 1, subtree[i].second = 0;
		return tree[i];
	}

	ll r_apply(ll l, ll r, ll a, ll b,ll depth, ll index) {
		ll left = (index - (1 << depth)) * (size >> depth);
		ll right = left + (size >> depth);
		if (l >= r || r <= left || right <= l) return identity;
		if (l <= left && right <= r) {
			composition(a, b, index);
			return calculation(index, depth);
		}
		propagate(index);
		ll ans = f(r_apply(l, r, a, b, depth + 1, index << 1), r_apply(l, r, a, b, depth + 1, index << 1 | 1));
		tree[index] = f(calculation(index << 1 | 1, depth + 1), calculation(index << 1, depth + 1));
		return ans;
	}

public:
	LazySegment(ll n, function<ll(ll a, ll b)> func, ll identity) :
	size(bit_ceil(static_cast<unsigned int>(n))), f(std::move(func)), identity(identity) {
		tree.resize(size * 2, identity);
		subtree.resize(size * 2, {1, 0});
		bata.push_back(1);
		for (ll i = 1; size >> i >= 1; i++) {
			bata.push_back(f(bata[i - 1], bata[i - 1]));
		}

	}

	ll set(ll index, ll val) {
		return apply(index, 0, val);
	}

	void setall(const vector<ll>& v) {
		ll index = 0;
		for (auto val : v) {
			set(index++, val);
		}
	}

	ll add(ll index, ll b) {
		return apply(index, 1, b);
	}

	ll multiply(ll index, ll a) {
		return apply(index, a, 0);
	}

	ll apply(ll i, ll a, ll b) {
		return range_apply(i, i + 1, a, b);
	}

	ll range_apply(ll l, ll r, ll a, ll b) {
		return r_apply(l, r, a, b, 0, 1);
	}

	ll query(ll l, ll r) {
		return range_apply(l, r, 1, 0);
	}
};


//
using namespace std;

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};


ll solve() {
	ll n; cin >> n;
	vector<ll> aa(n + 1);
	for (ll i = 1; i < n + 1; i++) {
		cin >> aa[i];
	}
	vector<ll> dp(n + 1, LONG_LONG_MAX);
	stack<ll> mi, ma;
	LazySegment seg(n + 1, [](ll a, ll b){ return min(a, b); }, INT_MAX);
	dp[0] = 0;
	seg.set(0, 0);
	for (ll i = 1; i < n + 1; i++) {
		ll r = aa[i];
		ll r_index = i;
		ll l_index = i;
		while (!mi.empty()) {
			if (r < aa[mi.top()]) {
				r_index = mi.top();
				mi.pop();
				if (!mi.empty()) {
					l_index = mi.top();
				} else {
					l_index = 0;
				}
				seg.range_apply(l_index, r_index, 1, aa[r_index]);
			} else {
				break;
			}
		}
		if (!mi.empty()) {
			l_index = mi.top();
		} else {
			l_index = 0;
		}
		if (l_index < i) {
			seg.range_apply(l_index, i, 1, -aa[i]);
		}
		mi.push(i);

		l_index = i;
		while (!ma.empty()) {
			if (r > aa[ma.top()]) {
				r_index = ma.top();
				ma.pop();
				if (!ma.empty()) {
					l_index = ma.top();
				} else {
					l_index = 0;
				}
				seg.range_apply(l_index, r_index, 1, -aa[r_index]);
			} else {
				break;
			}
		}
		if (!ma.empty()) {
				l_index = ma.top();
			} else {
				l_index = 0;
			}
		if (l_index < i) {
			seg.range_apply(l_index, i, 1, aa[i]);
		}
		ma.push(i);
		dp[i] = seg.query(0, i - 1);
		seg.set(i, dp[i]);
	}
	cout << dp[n] << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}
