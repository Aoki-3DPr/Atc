#include <bits/stdc++.h>
#include "LazySegmentTree.cpp"
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, q; cin >> n >> q;
	vector<ll> v(n);
	vector<ll> v1(n);
	vector<ll> v2(n);
	for (ll i = 0; i < n; i++) {
		cin >> v[i];
		v1[i] = v2[i] = v[i];
		if (v[i] == -1) {
			v1[i] = INT_MAX;
			v2[i] = INT_MIN;
		}
	}
	LazySegmentTree smin(n, [](ll a, ll b) { return min(a, b); }, INT_MAX);
	smin.setall(v1);
	LazySegmentTree smax(n, [](ll a, ll b) { return max(a, b); }, INT_MIN);
	smax.setall(v2);
	while (q--) {
		ll i, x, y; cin >> i >> x >> y;
		if (i == 1) {
			x--;
			smin.set(x, y);
			smax.set(x, y);
			if (y == -1) {
				smin.set(x, INT_MAX);
				smax.set(x, INT_MIN);
			}
		} else {
			x--;
			if (smin.query(x, y) == smax.query(x, y) || smax.query(x, y) == INT_MIN) {
				cout << "Yes" << endl;
			} else {
				cout << "No" << endl;
 			}
		}
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

