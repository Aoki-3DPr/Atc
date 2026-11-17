#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n; cin >> n;
	vector<ll> v(n);
	for (ll i= 0; i < n; i++) {
		cin >> v[i];
	}
	ll sum = 0;
	ll a = -1;
	ll aa = 0;
	for (ll i = 0; i < n; i++) {
		sum += v[i];
		if (sum == 0) {
			if (a < 0) {
				aa++;
				sum++;
			} else {
				aa++;
				sum--;
			}
		} else if (sum > 0 && a > 0) {
			aa += abs(sum) + 1;
			sum = -1;
		} else if (sum < 0 && a < 0) {
			aa += abs(sum) + 1;
			sum = 1;
		}
		if (sum > 0) {
			a = 1;
		} else {
			a = -1;
		}
	}

	sum = 0;
	a = 1;
	ll aaa = 0;
	for (ll i = 0; i < n; i++) {
		sum += v[i];
		if (sum == 0) {
			if (a < 0) {
				aaa++;
				sum++;
			} else {
				aaa++;
				sum--;
			}
		} else if (sum > 0 && a > 0) {
			aaa += abs(sum) + 1;
			sum = -1;
		} else if (sum < 0 && a < 0) {
			aaa += abs(sum) + 1;
			sum = 1;
		}
		if (sum > 0) {
			a = 1;
		} else {
			a = -1;
		}
	}
	cout << min(aa, aaa) << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

