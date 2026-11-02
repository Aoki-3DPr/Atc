#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll t; cin >> t;
	while (t--) {
		ll n; cin >> n;
		vector<ll> a(n);
		for (ll i = 0; i < n; i++) cin >> a[i];
		vector<ll> b;
		for (ll i = 0; i < n; i++) {
			if (a[i] < 0) b.push_back(a[i]);
		}
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

