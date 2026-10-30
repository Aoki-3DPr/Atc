#include <bits/stdc++.h>
#define ll long long
using namespace std;
int di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
int dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

bool range_check(int i, int j, int h, int w) { return 0 <= j && j < w && 0 <= i && i < h; }

ll pow2(ll n) { return n * n; }



ll solve() {
	ll n, k; cin >> n >> k;
	vector<ll> a(k);
	for (ll i = 0; i < k; i++) {
		cin >> a[i];
	}
	vector<pair<ll, ll>> b(n);
	for (ll i = 0; i < n; i++) {
		ll x, y; cin >> x >> y;
		b[i] = {x, y};
	}
	long double ans = 0;
	for (ll i = 0; i < n; i++) {
		for (ll j = 0; j < k; j++) {
			ans = min(ans, sqrt(pow2(b[i].first - b[a[j]].first) + pow2(b[i].second - b[a[j]].second)));
		}
	}
	return 0;
}

int main() {
	solve();
	return 0;
}
