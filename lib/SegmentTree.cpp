#pragma once
#include <bits/stdc++.h>

#include <utility>
#define ll long long
using namespace std;

class Segment {
private:
	ll size;
	ll identity;
	vector<ll> tree;

	function<ll(ll a, ll b)> f;
public:
	Segment(ll n, function<ll(ll a, ll b)> func, ll identity) :
	f(std::move(func)), identity(identity), size(bit_ceil(static_cast<unsigned int>(n))) {
		tree.resize(size * 2, identity);
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

	ll get(ll index) {
		return tree[index + size];
	}

	ll apply(ll i, ll a, ll b) {
		ll index = size + i;
		this->tree[index] = this->tree[index] * a + b;
		for (ll j = index >> 1; j >= 1; j >>= 1) {
			tree[j] = f(tree[j << 1],tree[j << 1 | 1]);
		}
		return tree[index];
	}

	ll query(ll l, ll r) {
		if (l >= r) return identity;
		ll ans = identity;
		for (ll i = l + size, j = r + size; i < j ; i >>= 1, j >>= 1) {
			if (i & 1) {ans = f(ans, tree[i++]);}
			if (j & 1) {ans = f(ans, tree[--j]);}
		}
		return ans;
	}
};


#ifdef BUILDING_LIB_STANDALONE
int main() {
	ll n = 100;
	Segment s(n, [](ll a, ll b) { return max(a, b); }, LONG_LONG_MIN);
	for (ll i = 0; i < n; i++) {
		s.set(i, i);
	}
	cout << s.query(0, n - 40) << endl;
}
#endif
